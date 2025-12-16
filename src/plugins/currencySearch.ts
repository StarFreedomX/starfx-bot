import path from "node:path";
// import { Canvas, loadImage } from "skia-canvas";
import { Chart, type ChartItem, registerables } from "chart.js";
import * as cheerio from "cheerio";
import { type Context, h, type Session } from "koishi";
import { assetsDir, type Config } from "../index";

Chart.register(...registerables);

let mvpAPIKey: string;

interface CurrencyCode {
	country: string;
	currencyCn: string;
	code: string;
}

interface PriceSeries {
	prices: number[];
	timeStamps: string[];
}

let currencyCodes: CurrencyCode[] = [];

let currencyCodesMap: Record<string, string> = {};

// TODO
export async function intervalGetExchangeRate(
	_ctx: Context,
	_cfg: Config,
	_session: Session,
	_searchString: string,
	_exchangeRatePath: string,
) {
	// TODO
}

async function parseNaturalCurrency(
	searchString: string,
): Promise<string | null> {
	const index = await getCurrencyCodesMap();
	const s = searchString.replace(/\s+/g, "");

	// A. 解析 “xxx兑yyy” / “xxx对yyy”
	const match = s.match(/(.+?)(兑|对)(.+)/);
	if (match) {
		const from = index[match[1]];
		const to = index[match[3]];

		if (from && to) {
			return from + to; // 生成如 JPNCNY / USDCNY
		}
	}

	if (index[s]) {
		return index[s];
	}
	return null;
}

export async function getExchangeRate(
	ctx: Context,
	cfg: Config,
	session: Session,
	searchString?: string,
	raw?: string,
	retryTimes = 1,
) {
	const apiKey = retryTimes ? await getMvpAPIKey() : await updateMvpAPIKey();
	try {
		let guids: string[] = [];
		// 尝试中文解析
		if (searchString) {
			const parsed = await parseNaturalCurrency(searchString);
			if (parsed) {
				searchString = parsed;
			}
		}

		if (raw && /^([a-z0-9]{6})([,\s]([a-z0-9]{6}))*$/.test(raw)) {
			guids = raw.split(",");
		} else if (
			/^([a-zA-Z]{3}|[a-zA-Z]{6})([,\s]([a-zA-Z]{3}|[a-zA-Z]{6}))*$/.test(
				searchString,
			)
		) {
			const currencies = await getCurrencyCodes(); // 返回 [{CurrencyCode: "CNY"}, ...]
			// 拆分字符串为单个6位代码
			const codes = searchString.split(/[,\s]+/);
			// 收集不合法的代码
			const invalidCodes: string[] = [];
			const search6Strings = [];
			codes.forEach((code) => {
				const first = code.slice(0, 3).toUpperCase();
				const second =
					code.length === 3 ? "CNY" : code.slice(3, 6).toUpperCase();
				search6Strings.push(code.length === 3 ? first + second : code);
				if (!currencies.some((c) => c.code === first)) invalidCodes.push(first);
				if (code.length === 6 && !currencies.some((c) => c.code === second))
					invalidCodes.push(second);
			});

			if (invalidCodes.length > 0) {
				throw new Error(`输入的货币代码不合法: ${invalidCodes.join(", ")}`);
			}
			guids = await getExchangeGuids(search6Strings.join(","), apiKey);
		}

		// guids 如果全是空字符串，就说明 symbol 无效
		if (!guids.length || guids.every((g) => !g)) {
			throw new Error(`输入无效: ${searchString}`);
		}

		const result: {
			name: string;
			nowPrice: number;
			fromCurrency: string;
			currency: string;
			// oneMonthChart: h;
			// fiveDayChart: h;
			currencyChart: h;
		}[] = [];

		for (const guid of guids) {
			if (!guid) throw new Error("GUID not found");

			const nowPriceArr = await getQuotes(guid, apiKey);
			const monthPriceArr = await getMSNPrices(guid, apiKey, "1M1H");
			const day5PriceArr = await getMSNPrices(guid, apiKey, "5D");
			const nowPrice = nowPriceArr?.[0];
			const oneMonthPrice = monthPriceArr?.[0];
			const fiveDayPrice = day5PriceArr?.[0];

			if (!nowPrice || !oneMonthPrice || !fiveDayPrice) {
				throw new Error("Failed to fetch price");
			}

			const monthChartBuffer = await drawCurrencyChartSkia(
				ctx,
				oneMonthPrice.prices,
				oneMonthPrice.timeStamps,
				`1 ${nowPrice.fromCurrency} to 1 ${nowPrice.currency}`,
			);
			// const monthImgSrc = "data:image/png;base64," + monthChartBuffer.toString("base64");
			const day5ChartBuffer = await drawCurrencyChartSkia(
				ctx,
				fiveDayPrice.prices,
				fiveDayPrice.timeStamps,
				`1 ${nowPrice.fromCurrency} to 1 ${nowPrice.currency}`,
			);
			// const day5ImgSrc = "data:image/png;base64," + day5ChartBuffer.toString("base64");
			const mergeImgSrc =
				"data:image/png;base64," +
				(
					await mergeBuffersVertical(ctx, day5ChartBuffer, monthChartBuffer)
				).toString("base64");
			result.push({
				name: nowPrice.symbolName,
				fromCurrency: nowPrice.fromCurrency,
				currency: nowPrice.currency,
				nowPrice: nowPrice.price,
				// oneMonthChart: h.image(monthImgSrc),
				// fiveDayChart: h.image(day5ImgSrc),
				currencyChart: h.image(mergeImgSrc),
			});
		}

		// 全部成功才发送
		for (const item of result) {
			await session.send([
				h.text(`
${new Date().toLocaleString()}
${item.name}
(${item.fromCurrency}/${item.currency})
当前价格: ${item.nowPrice}
近5天/近1个月价格走势:
`),
				item.currencyChart,
				// item.fiveDayChart,
				// h.text(`
				// 近30天价格走势:
				// `),
				// item.oneMonthChart
			]);
		}
	} catch (err) {
		if (retryTimes === 0) {
			// console.error("查询异常：", err);
			// 统一格式化错误文本
			const message =
				err instanceof Error
					? err.message
					: typeof err === "string"
						? err
						: JSON.stringify(err);

			await session.send(`查询失败：${message}`);
		} else {
			await getExchangeRate(
				ctx,
				cfg,
				session,
				searchString,
				raw,
				retryTimes - 1,
			);
		}
	}
}

/**
 * 上下拼接两张图片 Buffer
 * @param ctx2 koishi上下文
 * @param {Buffer} buf1 - 上图
 * @param {Buffer} buf2 - 下图
 * @returns {Promise<Buffer>} 合成后的 PNG Buffer
 */
async function mergeBuffersVertical(ctx2: Context, buf1: Buffer, buf2: Buffer) {
	const { Canvas, loadImage } = ctx2.skia;
	const img1 = await loadImage(buf1);
	const img2 = await loadImage(buf2);

	// 你说两张图片大小相同
	const width = img1.width;
	const height = img1.height + img2.height;

	const canvas = new Canvas(width, height);
	const ctx = canvas.getContext("2d");

	ctx.drawImage(img1, 0, 0);
	ctx.drawImage(img2, 0, img1.height);

	return await canvas.toBuffer("png");
}

async function updateMvpAPIKey(): Promise<string | null> {
	try {
		// 1. 获取 MSN 货币转换器页面 HTML
		const htmlResp = await fetch(
			"https://www.msn.com/zh-cn/money/tools/currencyconverter",
		);
		if (!htmlResp.ok)
			throw new Error(`Failed to fetch page: ${htmlResp.status}`);
		const html = await htmlResp.text();

		// 2. 使用 cheerio 解析 HTML
		const $ = cheerio.load(html);
		const head = $("head");
		const clientSettingsRaw = head.attr("data-client-settings");
		if (!clientSettingsRaw) throw new Error("未找到 data-client-settings 属性");

		// 3. 解析 JSON 获取版本号
		const clientSettings = JSON.parse(
			clientSettingsRaw.replace(/&quot;/g, '"'),
		);
		const version = clientSettings?.bundleInfo?.v;
		if (!version) throw new Error("未找到 bundleInfo.v");

		// 4. 构造 targetScope 并 encodeURIComponent
		const targetScope = encodeURIComponent(
			JSON.stringify({
				audienceMode: "adult",
				browser: {
					browserType: "edgeChromium",
					version: "142",
					ismobile: "false",
				},
				deviceFormFactor: "desktop",
				domain: "www.msn.com",
				locale: {
					content: { language: "zh", market: "cn" },
					display: { language: "zh", market: "cn" },
				},
				os: "windows",
				modes: { audienceMode: "adult" },
				platform: "web",
				pageType: "finance::financetools::financecurrencyconverter",
				pageExperiments: ["prg-cmc-river"],
			}),
		);

		const apiUrl = `https://assets.msn.com/resolver/api/resolve/v3/config/?expType=AppConfig&apptype=finance&v=${version}&targetScope=${targetScope}`;

		// 5. 请求 API JSON
		const apiResp = await fetch(apiUrl);
		if (!apiResp.ok)
			throw new Error(`Failed to fetch config API: ${apiResp.status}`);
		const json = await apiResp.json();

		// 6. 取出 mvpAPIkey
		const newMvpAPIKey =
			json?.configs?.["shared/msn-ns/CommonAutoSuggest/default"]?.properties
				?.mvpAPIkey ?? null;
		mvpAPIKey = newMvpAPIKey;
		return newMvpAPIKey;
	} catch (err) {
		console.error(err);
		return null;
	}
}

async function getMvpAPIKey(): Promise<string | null> {
	return mvpAPIKey ? mvpAPIKey : updateMvpAPIKey();
}

async function getExchangeGuids(
	symbols: string,
	apikey: string,
): Promise<string[]> {
	try {
		const url = `https://assets.msn.cn/service/Finance/IdMap?apikey=${apikey}&MStarIds=${encodeURIComponent(symbols)}`;
		// console.log(url)
		const resp = await fetch(url);
		// console.log(resp.ok)
		if (!resp.ok) throw new Error(`请求失败: ${resp.status}`);
		let data: Array<{
			mStarId: string;
			guid: string;
			type: string;
			exchangeId: string;
			symbol: string;
			status: number;
		}> = await resp.json();
		data = data.filter((d) => d.status === 200);
		// 返回 guid 数组，保持输入顺序
		const inputSymbols = symbols.split(",");
		const guidMap = new Map(data.map((item) => [item.mStarId, item.guid]));
		return inputSymbols.map((sym) => guidMap.get(sym) || "");
	} catch (err) {
		console.error(err);
		return [];
	}
}

/**
 * 获取 MSN 汇率 Quotes
 * @param ids guid 字符串，例如 "avdzk2,avyomw"
 * @param apiKey MSN mvpAPIKey
 * @returns 对应的 price + symbolName 数组
 */
async function getQuotes(
	ids: string,
	apiKey: string,
): Promise<
	{
		price: number;
		symbolName: string;
		fromCurrency: string;
		currency: string;
	}[]
> {
	try {
		const url = `https://assets.msn.com/service/Finance/Quotes?apikey=${encodeURIComponent(apiKey)}&cm=zh-cn&it=edgeid&ids=${encodeURIComponent(ids)}&wrapodata=false`;
		// console.log(url)
		const resp = await fetch(url);
		if (!resp.ok) throw new Error(`请求失败: ${resp.status}`);
		type price = {
			price: number;
			symbol: string;
			fromCurrency: string;
			currency: string;
			displayName: string;
			instrumentId: string;
			localizedAttributes: {
				[key: string]: {
					[value: string]: string;
				};
			};
		};
		const data: price[] | price[][] = await resp.json();

		// 1. 检查 data 是否为数组，如果不是，则将其包裹成数组，并断言为 price[] 或 price[][]
		const arrayData = Array.isArray(data)
			? data
			: ([data] as price[] | price[][]);

		let quotes: price[] = [];

		// 2. 检查 arrayData 是否为非空数组
		if (arrayData.length > 0) {
			// 检查第一个元素是否为数组，以确定嵌套深度
			if (Array.isArray(arrayData[0])) {
				// 情况 2：二维数组 (price[][]) -> 扁平化一层
				// flat(1) 确保只扁平化一层，as price[] 告诉 TypeScript 最终类型
				quotes = arrayData.flat(1) as price[];
			} else {
				// 情况 1：一维数组 (price[])
				quotes = arrayData as price[];
			}
		}

		// 返回结构包含 price 和 symbolName（中文名）
		const inputIds = ids.split(",");
		const quoteMap = new Map(
			quotes.map((q) => [
				q.instrumentId,
				{
					price: q.price,
					symbolName:
						q.localizedAttributes?.["zh-cn"]?.symbolName ||
						q.localizedAttributes?.["zh-cn"]?.displayName ||
						q.symbol,
					fromCurrency: q.fromCurrency || q.displayName,
					currency: q.currency,
				},
			]),
		);

		return inputIds.map(
			(id) =>
				quoteMap.get(id) ?? {
					price: 0,
					symbolName: "",
					fromCurrency: "",
					currency: "",
				},
		);
	} catch (err) {
		console.error(err);
		return [];
	}
}

async function getMSNPrices(
	ids: string,
	apiKey: string,
	type: "1M1H" | "1D1M" | "5D" = "1M1H",
): Promise<PriceSeries[]> {
	const url = `https://assets.msn.com/service/Finance/QuoteSummary?apikey=${apiKey}&ids=${ids}&intents=Charts,Exchanges&type=${type}&wrapodata=false`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
	type periodPrice = {
		instrumentId: string;
		chart: {
			series: {
				openPrices: number[];
				prices: number[];
				pricesHigh: number[];
				pricesLow: number[];
				priceHigh: number;
				priceLow: number;
				volumes: number[];
				timeStamps: string[];
				startTime: string;
				endTime: string;
			};
			chartType: string;
			exchangeId: string;
			instrumentId: string;
			timeLastUpdated: string;
		};
	};
	let data: periodPrice[] = await res.json();

	// 如果是二层数组，展平一层
	if (Array.isArray(data) && data.length && Array.isArray(data[0])) {
		data = data.flat(1);
	}

	if (!Array.isArray(data)) {
		throw new Error("Unexpected API response format");
	}

	// 提取 prices 和 timeStamps
	return data.map(
		(item: periodPrice): { prices: number[]; timeStamps: string[] } => {
			const series = item.chart?.series;
			return {
				prices: series?.prices || [],
				timeStamps: series?.timeStamps || [],
			};
		},
	);
}

/**
 * 绘制走势图
 * @param ctx koishi上下文
 * @param prices 收盘价数组
 * @param timeStamps ISO 时间戳数组
 * @param title 图表标题
 * @param width 图表宽度
 * @param height 图表高度
 * @returns buffer
 */
export async function drawCurrencyChartSkia(
	ctx: Context,
	prices: number[],
	timeStamps: string[],
	title = "兑换汇率",
	width = 1200,
	height = 600,
): Promise<Buffer> {
	if (
		!prices.length ||
		!timeStamps.length ||
		prices.length !== timeStamps.length
	)
		return;

	// 转成 {time, price} 对象
	const dataPoints = timeStamps.map((t, i) => ({
		x: new Date(t),
		y: prices[i],
	}));
	const { Canvas } = ctx.skia;
	// 创建 skia-canvas
	const canvas = new Canvas(width, height);

	const whiteBackground = {
		id: "whiteBackground",
		beforeDraw(chart: Chart) {
			const { ctx, width, height } = chart;
			ctx.save();
			ctx.fillStyle = "#ffffff";
			ctx.fillRect(0, 0, width, height);
			ctx.restore();
		},
	};

	new Chart(canvas as unknown as ChartItem, {
		type: "line",
		data: {
			datasets: [
				{
					label: title,
					data: dataPoints,
					showLine: true, // ⭐ 不连线，只画点
					pointRadius: 0, // 小点
					pointBorderWidth: 0, // ⭐ 去掉外边框 → 变成实心点
					borderWidth: 2,
					borderColor: "red",
					backgroundColor: "rgba(0,0,255,0.1)",
					tension: 0,
					segment: {
						borderDash: (ctx) => {
							const p0 = ctx.p0.parsed.x as number;
							const p1 = ctx.p1.parsed.x as number;
							const diffHours = (p1 - p0) / (1000 * 60 * 60);
							return diffHours > 2 ? [6, 4] : []; // 超过2h用虚线，否则实线
						},
					},
				},
			],
		},
		options: {
			responsive: false,
			scales: {
				x: {
					type: "time",
					time: {
						parser: "YYYY-MM-DD HH:mm:ss",
						tooltipFormat: "YYYY/MM/DD HH:mm",
						displayFormats: {
							hour: "HH:mm",
							day: "MM-DD",
						},
						unit: "day",
					},
					title: { display: true, text: "日期" },
				},
				y: {
					title: { display: true, text: "价格" },
				},
			},
			layout: {
				padding: { top: 20, bottom: 20, left: 20, right: 40 },
			},
		},
		plugins: [whiteBackground],
	});

	return await canvas.toBuffer("png");
}

export async function getCurrencyCodes(): Promise<CurrencyCode[]> {
	if (currencyCodes?.length) return currencyCodes;
	currencyCodes = require(
		path.resolve(assetsDir, "./currency.json"),
	) as CurrencyCode[];
	return currencyCodes;
}

export async function getCurrencyCodesMap(): Promise<Record<string, string>> {
	if (Object.keys(currencyCodesMap)?.length) return currencyCodesMap;
	currencyCodesMap = await buildCurrencyIndex();
	return currencyCodesMap;
}

async function buildCurrencyIndex(): Promise<Record<string, string>> {
	const map: Record<string, string> = {};

	(await getCurrencyCodes()).forEach((c) => {
		map[c.country] = c.code;
		map[c.currencyCn] = c.code;
	});
	map.日元 = "JPY";
	map.人民币 = "CNY";
	map.港币 = "HKD";
	return map;
}
