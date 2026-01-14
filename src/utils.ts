import fs from "node:fs";
import path from "node:path";
import type _sharp from "@quanhuzeyu/sharp-for-koishi";
import type { Sharp } from "@quanhuzeyu/sharp-for-koishi";
import { type Context, h, Random, type Session } from "koishi";
import { assetsDir, type Config, type recordLink, starfxLogger } from "./index";
import "chartjs-adapter-dayjs-3";

//功能控制
interface FeatureControl {
	[feature: string]: {
		whitelist: boolean;
		groups: number[];
	};
}

interface tagConfig {
	[gid: string]: string[];
}

/**
 * 添加投稿
 * @param ctx Context
 * @param gid 当前群组的gid，注意需要把:替换为_等其它字符
 * @param avatarUrl 图片的Url网络地址
 */
export async function addRecord(
	ctx: Context,
	gid: string,
	avatarUrl: string,
): Promise<string> {
	const recordDir = `${assetsDir}/record/${gid}`;
	const avatarBuffer = await ctx.http.get(avatarUrl, {
		responseType: "arraybuffer",
	});
	saveImage(avatarBuffer, recordDir);
	return "投稿收到啦";
}

/**
 * 从当前群组的语录中随机获取一张，同样需要把gid的:替换为_
 * @param cfg
 * @param gid
 * @param tag
 * @return 图片的文件路径
 */
export async function getRecord(
	cfg: Config,
	gid: string,
	tag: string,
): Promise<string | null> {
	const links = structuredClone(cfg.recordLink);
	links[gid] = { linkGroup: gid, linkWeight: 100 };
	const selectGid = getRandomLinkGroup(links).replaceAll(":", "_");
	const recordDir = path.join(assetsDir, "record", selectGid);
	const tagConfigPath = path.join(assetsDir, "tagConfig", `${selectGid}.json`);
	if (!fs.existsSync(recordDir)) return null;

	const files = fs
		.readdirSync(recordDir)
		.filter((file) => /\.(png|jpe?g|webp|gif)$/i.test(file));
	if (!files.length) return null;

	const tagConfigJson: tagConfig = fs.existsSync(tagConfigPath)
		? JSON.parse(fs.readFileSync(tagConfigPath, "utf8") || "{}")
		: {};

	// 构造带权重的条目
	const weighted: { file: string; weight: number }[] = files.map((file) => {
		const name = path.parse(file).name;
		const tags = tagConfigJson[name] || [];
		const weight = tag && tags.includes(tag) ? cfg.tagWeight : 1;
		return { file, weight };
	});

	// 加权随机选择
	const totalWeight = weighted.reduce((acc, cur) => acc + cur.weight, 0); //求和
	let rand = Math.random() * totalWeight; //随机

	for (const item of weighted) {
		rand -= item.weight;
		if (rand <= 0) {
			return path.join(recordDir, item.file);
		}
	}

	return null;
}
function getRandomLinkGroup(record: recordLink): string {
	// starfxLogger.info(record)
	const entries = Object.values(record);
	const totalWeight = entries.reduce((sum, item) => sum + item.linkWeight, 0);
	let r = Math.random() * totalWeight;
	for (const item of entries) {
		r -= item.linkWeight;
		if (r <= 0) {
			return item.linkGroup;
		}
	}
	return entries[entries.length - 1].linkGroup;
}

/**
 * 返回当前日期，格式为yyyyMMdd
 * @return 日期
 */
export function getTodayPrefix(): string {
	const now = new Date();
	const yyyy = now.getFullYear();
	const mm = String(now.getMonth() + 1).padStart(2, "0");
	const dd = String(now.getDate()).padStart(2, "0");
	return `${yyyy}${mm}${dd}`;
}

/**
 * 获取当前目录下特定`前缀+{数字}.后缀名`的{数字}的最大值+1
 * @param directory 检索的目录
 * @param prefix 前缀
 * @param suffix 后缀（可选，默认jpg）
 * @return 当前被使用的序列最大值+1
 */
export function getNextSequenceNumber(
	directory: string,
	prefix: string,
	suffix: string = "jpg",
): number {
	const files = fs.existsSync(directory) ? fs.readdirSync(directory) : [];
	const regex = new RegExp(`^${prefix}-(\\d+)\\.${suffix}$`);
	let maxNum = 0;
	files.forEach((file) => {
		const match = file.match(regex);
		if (match) {
			const num = parseInt(match[1], 10);
			if (num > maxNum) {
				maxNum = num;
			}
		}
	});
	return maxNum + 1;
}

/**
 * 保存图片到本地
 * @param arrayBuffer 传入的buffer，注意是arraybuffer
 * @param directory 保存的目录
 * @param filename 文件名 默认为yyyyMMdd-{num}.jpg
 */
export function saveImage(
	arrayBuffer: ArrayBuffer,
	directory: string,
	filename?: string,
) {
	if (!filename) {
		const prefix = getTodayPrefix();
		const seq = getNextSequenceNumber(directory, prefix);
		filename = `${prefix}-${seq}.jpg`;
	}
	const filepath = path.join(directory, filename);
	if (!fs.existsSync(directory)) {
		fs.mkdirSync(directory, { recursive: true });
	}
	const buffer = Buffer.from(arrayBuffer);
	fs.writeFileSync(filepath, buffer);
	console.log(`已保存图片：${filepath}`);
}

/**
 * 通过session、param判断获取图片的url
 * @param session 当前会话的Session
 * @param param 当前指令传入的param
 * @param option 获取选项
 *
 * @param option.number 通过发送消息param的数字转换为qq头像
 * @param option.img 是否检测发送消息中携带的字符串
 * @param option.at 是否检测发送消息所at对象返回qq头像
 * @param option.noParam 是否在没有参数时使用自身头像
 * @param option.quote 是否包括引用的消息
 * @return 图片url
 */
export async function getImageSrc(
	session: Session,
	param: string,
	option?: {
		number?: boolean;
		img?: boolean;
		at?: boolean;
		noParam?: boolean;
		quote?: boolean;
	},
): Promise<string> {
	const number = option?.number ?? true,
		img = option?.img ?? true,
		at = option?.at ?? true,
		noParam = option?.noParam ?? true,
		quote = option?.quote ?? true;

	//判断参数是不是纯数字或者没有参数
	if (number && param?.length && /^\d+$/.test(param)) {
		return `https://q1.qlogo.cn/g?b=qq&nk=${param}&s=640`;
	} else if (noParam && !param?.length) {
		return `https://q1.qlogo.cn/g?b=qq&nk=${session.userId}&s=640`;
	}

	if (quote) {
		//引用的消息中选择
		const quoteElementArray = session?.quote?.elements;
		if (quoteElementArray?.length) {
			for (const element of quoteElementArray) {
				if (img && element?.type === "img") {
					//console.log(element?.attrs?.src.slice(0,1000))
					return element?.attrs?.src;
				} else if (
					at &&
					element?.type === "at" &&
					element?.attrs?.id &&
					element.attrs.id !== session.selfId
				) {
					return `https://q1.qlogo.cn/g?b=qq&nk=${element?.attrs?.id}&s=640`;
				}
			}
		}
	}
	//发送的消息中选择
	const elementArray = session.elements;
	for (const element of elementArray) {
		if (img && element?.type === "img") {
			return element?.attrs?.src;
		} else if (at && element?.type === "at" && element?.attrs?.id) {
			return `https://q1.qlogo.cn/g?b=qq&nk=${element.attrs.id}&s=640`;
		}
	}
	//没有那么返回空值
	return "";
}
/**
 * 从url下载图片或读取本地文件并返回sharp对象
 * @param ctx Context
 * @param url 要获取的图片路径 (http://..., https://... 或 本地路径)
 * @return sharp对象
 */
export async function getImageFromUrl(
	ctx: Context,
	url: string,
): Promise<Sharp> {
	if (!url) throw new Error("URL must be provided");

	// 获取 Sharp 构造函数
	const sharp: typeof _sharp = ctx.QhzySharp.Sharp;

	try {
		let input: ArrayBuffer | string;

		// 检测是否为网络地址 (http 或 https)
		if (/^https?:\/\//i.test(url)) {
			const config = {
				responseType: "arraybuffer" as "arraybuffer",
			};
			input = await ctx.http.get(url, config);
		} else {
			input = url;
		}

		// sharp() 构造函数既支持 Buffer 也支持文件路径字符串
		return sharp(input).png();
	} catch (err) {
		console.error(`Error processing image from ${url}:`, err);
		throw new Error("Get image failed");
	}
}

/**
 * at不说话功能实现
 * @param cfg Koishi插件配置
 * @param session 当前会话Session对象
 * @param elements 当前消息elements
 */
export async function atNotSayReply(
	cfg: Config,
	session: Session,
	elements: h[],
) {
	const trimElements = elements.filter(
		(e) => !(e.type === "text" && /^\s*$/.test(e.attrs.content)),
	);
	//console.log(trimElements);
	// 处理仅包含at的情况
	if (
		(cfg.atNotSay || cfg.atNotSayOther) &&
		trimElements.length === 1 &&
		trimElements[0].type === "at"
	) {
		const isAtSelf = trimElements[0].attrs.id === session.selfId;

		if (isAtSelf && cfg.atNotSay && Random.bool(cfg.atNotSayProperty)) {
			await session.send(session.text("middleware.messages.atNotReply"));
		} else if (
			!isAtSelf &&
			cfg.atNotSayOther &&
			Random.bool(cfg.atNotSayOtherProperty)
		) {
			await session.send(session.text("middleware.messages.atNotReplyOther"));
		}
	}
}

/**
 * “我才不是机器人”回复功能
 * @param cfg Koishi插件配置
 * @param session 当前会话Session
 * @param elements 当前消息elements
 */
export async function replyBot(cfg: Config, session: Session, elements: h[]) {
	// 处理回复机器人的情况
	if (cfg.replyBot !== "关闭") {
		const bots = ["bot", "机器人", "Bot", "BOT", "机器人！", "机器人!", "人机"];
		const texts = elements
			?.filter((e) => e.type === "text")
			.map((e) => e?.attrs?.content?.trim());
		const ats = elements
			?.filter((e) => e.type === "at")
			.map((e) => e?.attrs?.id);

		const mentionedBot = texts?.some((t) => bots.includes(t));
		const atMe = ats?.includes(session.selfId);

		if (
			(elements?.length === 1 && mentionedBot && cfg.replyBot === "无需at") ||
			(elements?.length === 2 && mentionedBot && atMe)
		) {
			await session.send(session.text("middleware.messages.notBot"));
		}
	}
}

/**
 * 回复“我喜欢你”功能
 * @param cfg Koishi插件配置
 * @param session 当前会话Session
 * @param elements 当前消息elements
 */
export async function iLoveYou(cfg: Config, session: Session, elements: h[]) {
	// 处理表白情况
	if (cfg.iLoveYou) {
		const hasAtMe = elements?.some(
			(e) => e.type === "at" && e?.attrs?.id === session.selfId,
		);
		const hasLoveMessage = elements?.some(
			(e) =>
				e.type === "text" &&
				e?.attrs?.content?.trim() ===
					session.text("middleware.messages.loveMessage"),
		);

		if (elements?.length === 2 && hasAtMe && hasLoveMessage) {
			await session.send(
				session.text("middleware.messages.iLoveU", {
					at: h.at(session.userId),
					quote: h.quote(session.messageId),
				}),
			);
		}
	}
}

export function parseFeatureControl(
	array: { functionName: string; whitelist: boolean; groups: string }[],
): FeatureControl | null {
	try {
		return (
			Object.fromEntries(
				array.map(({ functionName, whitelist, groups }) =>
					functionName?.length
						? [
								functionName,
								{
									whitelist: !!whitelist,
									groups: groups?.split(",")?.map(Number).filter(Boolean) || [],
								},
							]
						: undefined,
				),
			) || {}
		);
	} catch (e) {
		starfxLogger.warn("[功能控制] 解析失败", e);
		return {};
	}
}

export function detectControl(
	controlJson: FeatureControl,
	guildId: string,
	funName: string,
) {
	const rule = controlJson?.[funName];
	if (!rule || rule.whitelist === undefined || !Array.isArray(rule.groups)) {
		return true; // 未配置或配置无效 -> 默认允许
	}
	const inList = rule.groups.includes(Number(guildId));
	return rule.whitelist ? inList : !inList;
}

export function handleRoll(session: Session) {
	// 提取元素内容
	const elements = session.elements;
	const parts = [];

	// 处理不同类型的元素
	for (const element of elements) {
		if (element?.type === "text") {
			let str = element.attrs.content;
			// 找一个不会出现在原字符串中的占位符
			let placeholder = "__TEMP__";
			while (str.includes(placeholder)) {
				placeholder += "_X";
			}
			str = str
				.replace(/我/g, placeholder)
				.replace(/你/g, "我")
				.replace(new RegExp(placeholder, "g"), "你");

			parts.push(...str.split(/(?:\s+)+/).filter(Boolean));
		} else {
			parts.push(element);
		}
	}
	console.log(parts);

	// 移除第一个元素(通常是命令本身)
	parts.shift();

	// 参数检查
	if (!parts) return session.text(".noParam");
	const last = session.elements[session.elements.length - 1];
	// 移除开头的命令
	// 处理概率计算
	if (
		last?.type === "text" &&
		last?.attrs?.content?.endsWith("概率") &&
		last?.attrs?.content?.length > 3
	) {
		return session.text(".possibility", {
			param: parts,
			possibility: Math.floor(Math.random() * 10000 + 1) / 100,
		});
	}

	// 处理骰子掷点
	const items = parts.join(" ").split("r").filter(Boolean);
	if (items.length === 2) {
		const [num, noodles] = items.map(Number);
		return getPoints(session, num, noodles);
	}

	const newParts = [];
	// 处理多选一
	parts.forEach((element) => {
		if (typeof element === "string") {
			newParts.push(...element.split(/(?:、|还是|，|,)+/).filter(Boolean));
		} else {
			newParts.push(element);
		}
	});
	if (newParts.length > 1) {
		return session.text(".choose", {
			option: Random.pick(newParts),
		});
	}
	return session.text(".noParam");
}

function getPoints(session: Session, num: number, noodles: number) {
	if (
		!Number.isInteger(num) ||
		!Number.isInteger(noodles) ||
		num <= 0 ||
		noodles <= 0
	)
		return session.text(".invalid");
	if (num > 20 || noodles > 100000000) return session.text(".too-many");
	const points = Array(num)
		.fill(0)
		.map(() => Math.floor(Math.random() * noodles + 1));
	return session.text(".noodles", {
		num,
		noodles,
		points: points.join(", "),
	});
}

/**
 * qq撤回功能（其他平台不知道w
 * @param _cfg config
 * @param session session
 */
export async function undo(_cfg: Config, session: Session) {
	if (
		session?.quote?.id &&
		session.quote.user.id === session.selfId &&
		Date.now() - session.quote.timestamp < 2 * 60 * 1000 - 5 * 1000
	) {
		//console.log(Date.now() - session.quote.timestamp)
		await session.bot.deleteMessage(
			session.channelId || session.guildId,
			session.quote.id,
		);
	}
}

export function safeQuote(str: string, useQuote: boolean): string {
	// 如果以双引号开头或结尾，就尝试去除它们（即使只有一侧也处理）
	let unquoted = str.trim();
	if (unquoted.startsWith('"')) {
		unquoted = unquoted.slice(1);
	}
	if (unquoted.endsWith('"')) {
		unquoted = unquoted.slice(0, -1);
	}

	if (useQuote) {
		return `"${unquoted}"`;
	} else {
		return unquoted;
	}
}

export function writeMap<K, V>(map: Map<K, V>, dest: string) {
	const dir = path.dirname(dest);
	// 自动创建目录（如果不存在）
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	fs.writeFileSync(dest, JSON.stringify([...map], null, 2), "utf-8");
}

export function readMap<K, V>(url: string): Map<K, V> {
	// 自动创建目录（如果不存在）
	if (!fs.existsSync(url)) {
		const map = new Map<K, V>();
		writeMap(map, url);
	}
	const raw = fs.readFileSync(url, "utf-8");
	const mapArray = JSON.parse(raw);
	return new Map(mapArray);
}

export function ready(
	session: Session,
	cfg: Config,
	param: string,
	readyMap: Map<string, string[]>,
) {
	const nowReadyMap: Map<string, string[]> = cfg.saveReadyAsFile
		? readMap(cfg.saveReadyAsFile)
		: readyMap;
	let strArr: string[] = nowReadyMap.get(session.gid) ?? [];
	let returnMessage = session.text(".invalid");
	if (param === "+" || param === "+1") {
		strArr.push(session.username);
		returnMessage = session.text(".addReady", {
			num: strArr.length,
			list: strArr.join("\n"),
		});
	} else if (param === "-" || param === "-1") {
		const newStrArr = strArr.filter((item) => item !== session.username);
		returnMessage =
			newStrArr.length !== strArr.length
				? session.text(".delReady", {
						num: newStrArr.length,
						list: newStrArr.join("\n"),
					})
				: session.text(".delFailed", {
						num: newStrArr.length,
						list: newStrArr.join("\n"),
					});
		strArr = newStrArr;
	} else if (param === "0") {
		strArr.length = 0;
		returnMessage = session.text(".clearReady");
	} else if (param === "" || !param) {
		returnMessage = session.text(".listReady", {
			num: strArr.length,
			list: strArr.join("\n"),
		});
	}
	nowReadyMap.set(session.gid, strArr);
	writeMap(nowReadyMap, cfg.saveReadyAsFile);
	return returnMessage;
}

// export async function test(url: string) {}
