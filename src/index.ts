import * as fs from "node:fs";
import path from "node:path";
import type {} from "@ltxhhz/koishi-plugin-skia-canvas";
import type {} from "@koishijs/plugin-server";
import type {} from "@koishijs/cache";
import type {} from "@quanhuzeyu/koishi-plugin-qhzy-sharp";
import { type Context, h, Logger, Random, Schema } from "koishi";
import * as crypto from 'crypto'
import mime from "mime-types";
import ejs from 'ejs'
import pkg from "../package.json";
import * as currency from "./plugins/currencySearch";
import * as drawHead from "./plugins/drawHead";
import * as getOriginImg from "./plugins/getOriginImg";
import * as utils from "./utils";

export const name = "starfx-bot";
export const inject = {
	optional: ["skia", "QhzySharp", "server","cache"],
};
declare module "@koishijs/cache" {
    interface Tables {
        // 动态表名：包含房间号
        // 这里我们将 Value 定义为 Song[]，因为 KTV 是一个歌曲列表
        ktv_room: Song[];
    }
}

interface Song {
    id: string
    title: string
    url?: string
}

interface OpLog {
    idArray: string[]
    hash: string
    song: Song
    toIndex: number
    timestamp: number
}
export let baseDir: string;
export let assetsDir: string;
export const starfxLogger: Logger = new Logger("starfx-bot");

export const usage = `
<h1>StarFreedomX的自用插件</h1>
<h2>可选功能依赖：</h2>
<h3><a href="/market?keyword=skia-canvas">skia</a></h3>
    <li>查汇率</li>
<h3><a href="/market?keyword=@quanhuzeyu+sharp">QhzySharp</a></h3>
    <li>卖掉了</li>
    <li>封印</li>
    <li>bdbd</li>
  `;
//复读共享上下文
export const repeatContextMap = new Map<string, [string, number]>();

interface sendLocalImageConfigItem {
	hiddenInHelp: boolean;
	imgPath: string;
}

interface sendLocalImageConfigDict {
	[key: string]: sendLocalImageConfigItem;
}

export interface recordLink {
	[key: string]: {
		linkGroup: string;
		linkWeight: number;
	};
}

export interface Config {
	//绘图
	openLock: boolean;
	openSold: boolean;
	bangdreamBorder: boolean;

	//语录
	record: boolean;
	tagWeight: number;
	recordLink: recordLink;
	saveArchive: boolean;

	//指令小功能
	roll: boolean;
	undo: boolean;
	echo: boolean;
	echoBanner: string[];
	ready: boolean;
	saveReadyAsFile: string;
	roomNumber: boolean;
	saveRoomAsFile: string;
	forward: boolean;
	searchExchangeRate: boolean;
	intervalGetExchangeRate: boolean;

	//回应
	atNotSay: boolean;
	atNotSayProperty: number;
	atNotSayOther: boolean;
	atNotSayOtherProperty: number;
	iLoveYou: boolean;
	replyBot: string;
	sendLocalImage: sendLocalImageConfigDict;

	//我的信息
	myId: boolean;

	//复读
	openRepeat: boolean;
	minRepeatTimes: number;
	repeatPossibility: number;

	//自用功能
	originImg: boolean;
	originImgRSSUrl: string;
	filePathToBase64: boolean;

	//功能控制
	featureControl: Array<{
		functionName: string;
		whitelist: boolean;
		groups: string;
	}>;
}

export const Config = Schema.intersect([
	Schema.object({
		openLock: Schema.boolean()
			.default(true)
			.description("开启明日方舟封印功能"),
		openSold: Schema.boolean()
			.default(true)
			.description('开启闲鱼"卖掉了"功能'),
		bangdreamBorder: Schema.boolean()
			.default(true)
			.description("开启BanG Dream!边框功能"),
	}).description("绘图功能"),
	Schema.object({
		record: Schema.boolean().default(true).description("开启群语录功能"),
		tagWeight: Schema.number()
			.default(5)
			.min(1)
			.description("tag匹配时的权重，越高权重越大"),
		recordLink: Schema.dict(
			Schema.object({
				linkGroup: Schema.string(),
				linkWeight: Schema.number(),
			}),
		)
			.role("table")
			.description(
				"群组链接，使得群可以调用被链接群的语录，<br>可以配置权重，作为键的群自身的权重为100(注意格式为平台名:群组名)",
			),
		saveArchive: Schema.boolean()
			.default(false)
			.description("开启入典功能")
			.hidden(),
	}).description("语录记录功能"),
	Schema.object({
		roll: Schema.boolean().default(true).description("开启roll随机数功能"),
		undo: Schema.boolean()
			.default(true)
			.description("机器人撤回消息功能(只测试了qq的onebot适配器)"),
		echo: Schema.boolean().default(true).description("echo回声洞功能"),
		echoBanner: Schema.array(String)
			.role("table")
			.description("echo屏蔽词，对文本生效"),
		ready: Schema.boolean().default(false).description("待机人数记录功能"),
		saveReadyAsFile: Schema.string().description(
			"写入待机人数的本地地址，留空则不写入",
		),
		roomNumber: Schema.boolean()
			.default(false)
			.description("主跑房间号记录功能"),
		saveRoomAsFile: Schema.string().description(
			"写入房间号的本地地址，留空则不写入",
		),
		forward: Schema.boolean().default(true).description("消息转发功能"),
		searchExchangeRate: Schema.boolean()
			.default(false)
			.description("查汇率功能"),
		intervalGetExchangeRate: Schema.boolean()
			.default(false)
			.description("汇率定时推送功能")
			.hidden(),
	}).description("指令小功能"),
	Schema.object({
		atNotSay: Schema.boolean()
			.default(true)
			.description("开启‘艾特我又不说话’功能"),
		atNotSayProperty: Schema.number()
			.role("slider")
			.min(0)
			.max(1)
			.step(0.01)
			.default(0.5)
			.description("'艾特我又不说话'回复概率"),
		atNotSayOther: Schema.boolean()
			.default(true)
			.description("开启‘艾特他又不说话’功能"),
		atNotSayOtherProperty: Schema.number()
			.role("slider")
			.min(0)
			.max(1)
			.step(0.01)
			.default(0.5)
			.description("'艾特他又不说话'回复概率"),
		iLoveYou: Schema.boolean().default(true).description("开启‘我喜欢你’功能"),
		replyBot: Schema.union(["关闭", "无需at", "必须at"])
			.default("无需at")
			.description("回复‘我才不是机器人！’功能"),
	}).description("特定回应功能"),
	Schema.object({
		sendLocalImage: Schema.dict(
			Schema.object({
				hiddenInHelp: Schema.boolean(),
				imgPath: Schema.string(),
			}),
		)
			.role("table")
			.description(
				"特定指令发送本地图片功能，其中键是指令名称，imgPath是图片文件的绝对路径",
			),
	}),
	Schema.object({
		openRepeat: Schema.boolean().default(true).description("开启复读功能"),
		minRepeatTimes: Schema.number().default(2).description("最少重复次数"),
		repeatPossibility: Schema.number()
			.role("slider")
			.min(0)
			.max(1)
			.step(0.01)
			.default(0.3)
			.description("复读发生概率"),
	}).description("复读功能"),
	Schema.object({
		myId: Schema.boolean().default(false).description("查询gid uid cid"),
	}).description("我的信息查询"),
	Schema.object({
		filePathToBase64: Schema.boolean()
			.default(false)
			.description(
				"在消息发送前检查是否有file://,如果有那么转换为base64再发送",
			),
		originImg: Schema.boolean()
			.default(false)
			.description("根据链接获取原图开关"),
	}).description("自用功能"),
	Schema.union([
		Schema.object({
			originImg: Schema.const(true).required(),
			originImgRSSUrl: Schema.string()
				.required()
				.description("推特列表rss地址"),
		}),
		Schema.object({}),
	]),

	Schema.object({
		featureControl: Schema.array(
			Schema.object({
				functionName: Schema.string(),
				whitelist: Schema.boolean(),
				groups: Schema.string(),
			}),
		)
			.role("table")
			.description(`黑/白名单配置，群组间用英文半角逗号分隔，<br>
可配置功能键及用法详见 [项目地址](https://github.com/StarFreedomX/starfx-bot)或[npm发布页](https://www.npmjs.com/package/koishi-plugin-bangdream-ccg)`),
	}).description("高级配置"),
]);

export function apply(ctx: Context, cfg: Config) {
	ctx.i18n.define("zh-CN", require("./locales/zh-CN"));

	baseDir = ctx.baseDir;
	assetsDir = `${ctx.baseDir}/data/starfx-bot/assets`;
	//init
	initAssets();
	// write your plugin here

	let featureControl = utils.parseFeatureControl(cfg.featureControl);

	if (cfg.openLock) {
		ctx.command("封印 [param]").action(async ({ session }, param) => {
			if (
				ctx.QhzySharp &&
				utils.detectControl(featureControl, session.guildId, "lock")
			)
				await session.send(
					await drawHead.drawLock(ctx, await utils.getImageSrc(session, param)),
				);
		});
	}

	if (cfg.openSold) {
		ctx.command("卖掉了 [param]").action(async ({ session }, param) => {
			//console.log('ssssss')
			if (
				ctx.QhzySharp &&
				utils.detectControl(featureControl, session.guildId, "sold")
			)
				await session.send(
					await drawHead.drawSold(ctx, await utils.getImageSrc(session, param)),
				);
		});
	}

	if (cfg.roll) {
		ctx.command("roll").action(async ({ session }) => {
			if (utils.detectControl(featureControl, session.guildId, "roll")) {
				return utils.handleRoll(session);
			}
		});
	}

	if (cfg.echo) {
		ctx
			.command("echo <params>")
			.option("time", "-t <time: number> 指定时间(min)")
			.action(async ({ session, options }, params) => {
				if (utils.detectControl(featureControl, session.guildId, "echo")) {
					const elements = session.elements;
					// console.log(elements)
					const getEchoMessage = () => {
						try {
							//console.log(elements);
							//第一个肯定是指令(其实可能是at)
							while (
								elements[0].type === "at" ||
								(elements[0].type === "text" &&
									!elements[0].attrs?.content.trim())
							)
								elements.shift();
							elements[0].attrs.content = elements[0].attrs?.content
								.trim()
								.split(/\s/)
								.slice(1)
								.join(" ");
							elements.forEach((ele) => {
								ele.attrs.content = ele.attrs?.content
									.trim()
									.split(/\s/)
									.filter(
										(v: string, i: number, a: string[]) =>
											v !== "-t" && a[i - 1] !== "-t",
									)
									.join(" ");
							});
							//console.log(elements);
							//如果什么内容都没有
							if (elements.length === 1 && !elements[0].attrs.content?.length) {
								if (
									cfg.echoBanner?.some((banText) =>
										session.quote?.content?.includes(banText),
									)
								)
									return "包含屏蔽词，打断echo";
								return session.quote?.elements;
							}
							if (
								cfg.echoBanner?.some((banText) =>
									session.content?.includes(banText),
								)
							)
								return "包含屏蔽词，打断echo";
							return elements;
						} catch (_e) {
							return params;
						}
					};
					const echoMessages = getEchoMessage();
					if (!options?.time && options.time > 0) {
						return echoMessages;
					} else {
						setTimeout(
							async () => {
								await ctx.broadcast([session.gid], echoMessages);
							},
							options.time * 60 * 1000,
						);
					}
				}
			});
	}

	if (cfg.bangdreamBorder) {
		ctx
			.command("bdbd [param]")
			.option("starNum", "-n <starNum: number>")
			.option("color", "-c <color: string>")
			.option("train", "-t <train: string>")
			.option("band", "-b <band: string>")
			.action(async ({ session, options }, param) => {
				if (
					ctx.QhzySharp &&
					utils.detectControl(featureControl, session.guildId, "bdbd")
				) {
					const drawConfig = await drawHead.handleBanGDreamConfig(options);
					const imgSrc = await utils.getImageSrc(session, param);
					if (!imgSrc?.length) return "输入无效";
					const imageBase64: string = await drawHead.drawBanGDream(
						ctx,
						imgSrc,
						drawConfig,
					);
					if (!imageBase64?.length) return "输入无效";
					await session.send(h.image(imageBase64));
				}
			});
	}

	if (cfg.record) {
		ctx.command("投稿 [param]").action(async ({ session }, param) => {
			if (
				utils.detectControl(featureControl, session.guildId, "record") &&
				utils.detectControl(featureControl, session.guildId, "record-push")
			) {
				const imageSrc = await utils.getImageSrc(session, param, {
					img: true,
					at: false,
					quote: true,
					noParam: false,
					number: false,
				});
				if (!imageSrc) {
					return "请发送带图片的指令消息或引用图片消息进行投稿";
				}
				return await utils.addRecord(
					ctx,
					session.gid.replaceAll(":", "_"),
					imageSrc,
				);
			}
		});
		ctx.command("语录 [tag:string]").action(async ({ session }, tag) => {
			if (
				utils.detectControl(featureControl, session.guildId, "record") &&
				utils.detectControl(featureControl, session.guildId, "record-get")
			) {
				const filepath = await utils.getRecord(
					cfg,
					session.gid.replaceAll(":", "_"),
					tag,
				);
				starfxLogger.info(`send record: ${filepath}`);
				if (!filepath) return "暂无语录呢";
				await session.send(h.image(filepath));
			}
		});
	}

	for (const key in cfg.sendLocalImage) {
		ctx //@ts-expect-error
			.command(key, { hidden: cfg.sendLocalImage[key].hiddenInHelp })
			.action(async ({ session }) => {
				if (
					utils.detectControl(
						featureControl,
						session.guildId,
						"sendLocalImage",
					) &&
					utils.detectControl(featureControl, session.guildId, key)
				)
					return h.image(
						utils.safeQuote(cfg.sendLocalImage[key].imgPath, false),
					);
			});
	}

	if (cfg.roomNumber) {
		const roomNumMap = new Map<string, string>();
		ctx
			.command("room-number [param: string]")
			.usage("记录房间号")
			.action(async ({ session }, param) => {
				const nowRoomNumMap: Map<string, string> = cfg.saveRoomAsFile
					? utils.readMap(cfg.saveRoomAsFile)
					: roomNumMap;
				const room = nowRoomNumMap.get(session.gid);
				if (!param) {
					return room
						? session.text(".roomNumber", {
								room: room,
							})
						: session.text(".noRoom");
				} else {
					let returnMessage = session.text(".invalid");
					if (/^[0-9]{5,6}$/.test(param)) {
						const had = nowRoomNumMap.get(session.gid);
						nowRoomNumMap.set(session.gid, param);
						returnMessage = had
							? session.text(".changeRoom", { oldRoom: room, newRoom: param })
							: session.text(".newRoom", { room: param });
					} else if (String(param) === "0") {
						nowRoomNumMap.delete(session.gid);
						returnMessage = session.text(".delRoom", { room: room });
					}
					utils.writeMap(nowRoomNumMap, cfg.saveRoomAsFile);
					return returnMessage;
				}
			});
	}

	if (cfg.ready) {
		const readyMap = new Map<string, string[]>();
		ctx
			.command("waiting-play [param:text]", { strictOptions: true })
			.usage("待机")
			.action(async ({ session }, param) => {
				return utils.ready(session, cfg, param, readyMap);
			});
	}

	if (cfg.saveArchive) {
		ctx.command("入典").action(async ({ session }) => {
			if (!session.quote) return "请引用合并转发聊天记录进行入典";
		});
	}

	if (cfg.undo) {
		ctx
			.command("undo")
			.alias("撤回")
			.usage("撤回消息")
			.action(async ({ session }) => {
				if (utils.detectControl(featureControl, session.guildId, "undo"))
					await utils.undo(cfg, session);
			});
	}

	if (cfg.forward) {
		ctx
			.command("forward")
			.option("group", "-g <group:string>")
			.option("platform", "-p <platform:string>")
			.usage("转发消息")
			.action(async ({ session, options }) => {
				if (utils.detectControl(featureControl, session.guildId, "forward")) {
					const mapPath = path.join(assetsDir, "forward.json");
					const groupMap: Map<string, string> = utils.readMap(mapPath);
					if (options.group) {
						if (["0", "clear", "del"].includes(options.group)) {
							const gid = groupMap.get(session.gid);
							groupMap.delete(session.gid);
							utils.writeMap(groupMap, mapPath);
							return session.text(".delete", { gid: gid });
						}
						const target = `${options.platform || session.platform}:${options.group}`;
						groupMap.set(session.gid, target);
						utils.writeMap(groupMap, mapPath);
						if (!session.quote?.content?.length)
							return session.text(".setOK", { target: target });
					}
					const target = groupMap.get(session.gid);
					if (!target) return session.text(".noTarget");
					if (!session.quote?.content?.length)
						return session.text(".noMessage");
					const forwardContent: string = session.text(".forwardContent", {
						content: session.quote.content,
					});
					await ctx.broadcast([target], forwardContent);
					return session.text(".success", { target: target });
				}
			});
	}

	if (cfg.originImg) {
		ctx
			.command("获取X原图")
			.alias("推特原图")
			.usage("获取推特原图")
			.action(async ({ session }) => {
				if (utils.detectControl(featureControl, session.guildId, "originImg")) {
					let [xUrls, xIndex] = await Promise.all([
						getOriginImg.getXUrl(session?.quote?.content),
						getOriginImg.getXNum(session),
					]);
					xIndex = xIndex.length ? xIndex : xUrls.map((_, i) => i);
					const filteredUrls = xIndex
						.filter((i) => i >= 0 && i < xUrls.length)
						.map((i) => xUrls[i]);
					const imageUrls = await getOriginImg.getXImage(
						cfg.originImgRSSUrl,
						filteredUrls,
					);
					await getOriginImg.sendImages(ctx, session, imageUrls);
				}
			});
	}

	if (cfg.myId) {
		ctx
			.command("my-gid")
			.action(({ session }) =>
				utils.detectControl(featureControl, session.guildId, "myId")
					? session.gid
					: "",
			);
		ctx
			.command("my-uid")
			.action(({ session }) =>
				utils.detectControl(featureControl, session.guildId, "myId")
					? session.uid
					: "",
			);
		ctx
			.command("my-cid")
			.action(({ session }) =>
				utils.detectControl(featureControl, session.guildId, "myId")
					? session.cid
					: "",
			);
	}

	if (cfg.searchExchangeRate) {
		ctx
			.command("查汇率 <exchangeParam:text>")
			.usage("查询当前汇率")
			.example("查汇率 JPY : 查询日元兑换人民币的汇率(3位字母)")
			.example("查汇率 JPYCNY : 查询日元兑换人民币的汇率(6位字母)")
			.example("查汇率 -r avdzk2 : 查询日元兑换人民币的汇率(msn代码avdzk2)")
			.example(
				"查汇率 -r auvwoc : 查询黄金的价格(msn代码auvwoc, 很怪吧我也不知道为什么是这个)",
			)
			.option("raw", "-r <raw:string>")
			.action(async ({ session, options }, exchangeParam) => {
				if (
					ctx.skia &&
					utils.detectControl(featureControl, session.guildId, "exchangeRate")
				) {
					return await currency.getExchangeRate(
						ctx,
						cfg,
						session,
						exchangeParam,
						options?.raw,
					);
				}
			});
	}

	if (cfg.intervalGetExchangeRate) {
		ctx
			.command("开启汇率推送 [exchangeParam:string]")
			.action(async ({ session }, exchangeParam) => {
				if (
					ctx.skia &&
					utils.detectControl(featureControl, session.guildId, "exchangeRate")
				) {
					const exchangeRatePath = path.join(assetsDir, "exchangeRate.json");
					return await currency.intervalGetExchangeRate(
						ctx,
						cfg,
						session,
						exchangeParam,
						exchangeRatePath,
					);
				}
			});
	}

	if (cfg.filePathToBase64) {
		ctx.before("send", (session) => {
			for (const element of session.elements) {
				const src = element.attrs?.src;
				if (!src || !isLocalPath(src)) continue;
				// 将 src 路径转换为文件系统可识别的路径
				const filePath = convertUriToLocalPath(src);
				// 获取 MIME 类型
				const mimeType =
					mime.lookup(filePath) ||
					guessTypeFromElement(element.type) ||
					"application/octet-stream";
				// 读取文件并转换为 Base64
				const base64 = toBase64String(filePath);
				// 如果转换成功，更新 element 的 src
				if (base64) element.attrs.src = `data:${mimeType};base64,${base64}`;
			}
		});

		/**
		 * 检查 src 字符串是否以本地路径格式开头。
		 * @param src - 待检查的字符串。
		 */
		function isLocalPath(src: string): boolean {
			// 正则表达式：识别任何本地路径的开始，包括 file:/// URI
			// 匹配项：/ (Linux 根), \ (Windows 根/UNC), file:/// (URI), . (相对路径), C:\ (Windows 盘符), /home/, /root/, ../, ./
			const LOCAL_PATH_REGEX =
				/^(\/|\\|file:\/\/\/|\.|[A-Za-z]:\\|\/home\/|\/root\/|\.\.\/|\.\/)/;
			// 使用正则表达式进行本地路径检测
			return LOCAL_PATH_REGEX.test(src);
		}

		/**
		 * 将 (file:///) URI 转换为本地文件系统路径。
		 * @param uri - 可能是 file:/// 格式的 URI。
		 */
		/**
		 * 将 (file:///) URI 转换为本地文件系统路径。
		 * * 使用 URL API 来安全地解析文件URI，并确保在不同平台上的路径格式正确。
		 * @param uri - 可能是 file:/// 格式的 URI。
		 */
		function convertUriToLocalPath(uri: string): string {
			// 1. 检查是否是 file:// URI
			if (uri.startsWith("file://")) {
				try {
					const url = new URL(uri);

					// url.pathname 包含了解码后的路径部分
					let filePath = url.pathname;

					// 2. 特殊处理 Windows 路径：
					// 在 Windows 上，url.pathname 总是以斜杠开头，例如 /C:/path
					// 必须移除这个多余的斜杠，否则可能导致 fs 模块解析为 C:\C:\path
					if (process.platform === "win32") {
						// 检查路径是否是 /C:/... 这种格式
						if (filePath.match(/^\/[A-Za-z]:\//)) {
							// 移除第一个斜杠 /
							filePath = filePath.substring(1);
						} else {
							// 如果是 UNC 路径 (如 //server)，url.pathname 会是 //server/share
							// 在 Windows 上，需要 path.normalize 来处理双斜杠
						}
					}

					// 3. Linux/Unix 路径：
					// 对于 file:///home/user，url.pathname 返回 /home/user，根目录 / 被保留。

					// 4. 标准化路径，处理斜杠/反斜杠，确保 fs 模块能识别
					// 无论 Windows 还是 Linux，path.normalize 都能很好地处理格式
					return path.normalize(filePath);
				} catch (e) {
					starfxLogger.error("URL解析失败:", e);
					return uri; // 解析失败则返回原 URI
				}
			}

			// 5. 处理非 URI 的本地路径 (如 /home/user 或 C:\path)
			// 确保相对路径被正确解析，并标准化
			if (path.isAbsolute(uri) || uri.startsWith(".") || uri.startsWith("..")) {
				return path.normalize(uri);
			}

			return uri; // 如果不是 file:/// 也不是其他本地路径，则原样返回
		}

		/**
		 * 读取本地文件并将其转换为 Base64 字符串。
		 * @param src - 本地文件路径。
		 */
		function toBase64String(src: string): string {
			try {
				const data = fs.readFileSync(src);
				return data.toString("base64");
			} catch (err) {
				starfxLogger.error(
					`[Error] 无法读取本地文件 (${src}) 并转换为 Base64:`,
					err,
				);
				return undefined;
			}
		}

		function guessTypeFromElement(type: string): string | undefined {
			switch (type) {
				case "img":
				case "image":
					return "image/png";
				case "record":
					return "audio/mpeg";
				case "video":
					return "video/mp4";
				default:
					return undefined;
			}
		}
	}

    if (ctx.server) {
        // // 预读模板文件
        // const templatePath = path.resolve(__dirname,'./static/songRoom.ejs')
        // const templateStr = fs.readFileSync(templatePath, 'utf-8')

        // 缓存变量，按 roomId 分隔
        const roomOpCache: Record<string, OpLog[]> = {}
        const roomSongsCache: Record<string, Song[]> = {}

        // --- 修改 1：生成哈希工具函数 ---
        function getHash(songs: Song[]) {
            // 将 id, title, url 连成字符串。如果包含特殊字符，建议用 JSON.stringify
            const content = songs.map(s => `${s.id}|${s.title}|${s.url}`).join(',');
            return crypto.createHash('md5').update(content).digest('hex');
        }

        // 每 5 分钟检测并清理 5 分钟前的缓存
        ctx.setInterval(() => {
            const now = Date.now();
            for (const roomId in roomOpCache) {
                roomOpCache[roomId] = roomOpCache[roomId].filter(log => now - log.timestamp < 5 * 60 * 1000);
                if (roomOpCache[roomId].length === 0) delete roomOpCache[roomId];
            }
        }, 5 * 60 * 1000);


        // 获取歌曲列表及当前哈希
        // --- 修改 2：获取 API 逻辑 ---
        ctx.server.get('/songRoom/api/:roomId', async (koaCtx) => {
            const { roomId } = koaCtx.params;
            const { lastHash: clientHash } = koaCtx.query;

            if (!roomSongsCache[roomId]?.length){
                roomSongsCache[roomId] = (await ctx.cache.get("ktv_room", roomId) || [])
            }

            // 传入整个 songs 数组而不是 ids
            const serverHash = getHash(roomSongsCache[roomId]);

            if (!roomOpCache[roomId]) {
                // OpLog 里的 idArray 建议也改为全量数据备份，或者至少在重演时能拿到内容
                roomOpCache[roomId] = [{
                    idArray: roomSongsCache[roomId].map(s => s.id), // 顺序校验仍用 ID
                    hash: serverHash,
                    song: null,
                    toIndex: -1,
                    timestamp: Date.now()
                }];
            }

            if (clientHash === serverHash) {
                return koaCtx.body = { changed: false, hash: serverHash };
            }

            koaCtx.body = {
                changed: true,
                list: roomSongsCache[roomId],
                hash: serverHash
            };
        });

        // 核心 Move/Add/Delete 逻辑
        ctx.server.post('/songRoom/api/:roomId', async (koaCtx) => {
            const { roomId } = koaCtx.params;
            // 1. 获取请求体，强制定义为 Readonly 以防止在逻辑层意外修改原始请求数据
            const body = koaCtx.request["body"] as {
                idArrayHash: string,
                song: Song,
                toIndex: number
            };

            const { idArrayHash, song, toIndex } = body;

            const logs = roomOpCache[roomId] || [];
            const hitIdx = logs.findIndex(l => l.hash === idArrayHash);

            // 如果 Hash 对不上，说明前端基于旧列表操作，拒绝并让前端回滚刷新
            if (hitIdx === -1) return koaCtx.body = { success: false, code: 'REJECT' };

            // 准备数据快照
            const baseLog = logs[hitIdx];
            const spotIds = [...baseLog.idArray]; // 基础 ID 序列
            const nowSongs = roomSongsCache[roomId] || [];

            // 将当前操作封存进日志流（注意：此时尚未执行，先入列）
            const currentOp: OpLog = {
                idArray: [], // 此时 finalIdArray 还没算出，后面补上
                hash: '',
                song: song,
                toIndex: toIndex,
                timestamp: Date.now()
            };
            // console.log(currentOp)
            // 获取当前 hit 之后的所有后续操作（包含当前这次）
            const laterOps = [...logs.slice(hitIdx + 1), currentOp];

            // 执行链表运算：基于 hit 时的状态，重演后面所有的操作
            const finalSongs = songOperation(nowSongs, spotIds, laterOps);
            // console.log({ nowSongs, finalSongs })

            // 更新缓存与数据库
            const finalIds = finalSongs.map(s => s.id);
            const finalHash = getHash(finalSongs);

            // 完善 OpLog：记录本次操作后的最终状态，供下一个并发请求作为 base
            currentOp.idArray = finalIds;
            currentOp.hash = finalHash;
            logs.push(currentOp);

            // 更新内存缓存与持久化层
            roomSongsCache[roomId] = finalSongs;
            await ctx.cache.set(`ktv_room`, roomId, finalSongs);

            koaCtx.body = { success: true, hash: finalHash };
        });


        function songOperation(nowSongs: Song[], songIdArray: string[], ops: OpLog[]): Song[] {
            // --- 第一步：构建最新的 Song 状态池 ---
            const latestSongMap = new Map<string, Song>();

            // 初始数据判空
            if (Array.isArray(nowSongs)) {
                nowSongs.forEach(s => s && s.id && latestSongMap.set(s.id, s));
            }

            // 更新状态池，增加 op 和 song 的安全校验
            [...ops].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)).forEach(op => {
                if (op?.song?.id && op.toIndex !== -1) {
                    latestSongMap.set(op.song.id, op.song);
                }
            });

            // --- 第二步：双向链表处理 ---
            class ListNode {
                val: string | number;
                prev: ListNode | null = null;
                next: ListNode | null = null;
                constructor(val: string | number) { this.val = val; }
            }

            const head = new ListNode('HEAD');
            let current = head;
            const idNodes = new Map<string, ListNode>();
            const anchorNodes = new Map<number, ListNode>();

            // 初始化链表：这里是受控循环，结构是稳定的
            for (let i = 0; i <= (songIdArray?.length || 0); i++) {
                const anchorNode = new ListNode(i);
                anchorNodes.set(i, anchorNode);

                current.next = anchorNode;
                anchorNode.prev = current;
                current = anchorNode;

                if (i < songIdArray.length) {
                    const id = songIdArray[i];
                    if (id !== undefined && id !== null) {
                        const idNode = new ListNode(id);
                        idNodes.set(id, idNode);
                        current.next = idNode;
                        idNode.prev = current;
                        current = idNode;
                    }
                }
            }

            // 执行逻辑
            ops.forEach(op => {
                if (!op?.song?.id) return;
                const { song, toIndex } = op;
                let node = idNodes.get(song.id);

                // 1. 安全断开旧连接
                if (node && node.prev) {
                    const prevNode = node.prev;
                    const nextNode = node.next;
                    prevNode.next = nextNode;
                    if (nextNode) {
                        nextNode.prev = prevNode;
                    }
                    // 彻底切断当前节点的旧联系，防止逻辑干扰
                    node.prev = null;
                    node.next = null;
                }

                // 2. 删除操作
                if (toIndex === -1) {
                    idNodes.delete(song.id);
                    return;
                }

                // 3. 创建/重用节点
                if (!node) {
                    node = new ListNode(song.id);
                    idNodes.set(song.id, node);
                }

                // 4. 安全挂载到锚点
                const targetAnchor = anchorNodes.get(toIndex);
                // 必须确保 targetAnchor 存在，且由于 HEAD 的存在，targetAnchor.prev 理论上不为空
                if (targetAnchor && targetAnchor.prev) {
                    const before = targetAnchor.prev;

                    before.next = node;
                    node.prev = before;

                    node.next = targetAnchor;
                    targetAnchor.prev = node;
                }
            });

            // --- 第三步：转换回数组 ---
            const result: Song[] = [];
            let p: ListNode | null = head.next;

            while (p !== null) {
                if (typeof p.val === 'string' && p.val !== 'HEAD') {
                    const songData = latestSongMap.get(p.val);
                    if (songData) {
                        result.push(songData);
                    }
                }
                p = p.next;
            }

            return result;
        }

        // WebUI 托管
        // 访问地址示例：http://localhost:5140/songRoom/12345
        ctx.server.get('/songRoom/:roomId', async (koaCtx) => {
            // 预读模板文件
            const templatePath = path.resolve(__dirname, './static/songRoom.ejs')
            const templateStr = fs.readFileSync(templatePath, 'utf-8')
            const { roomId } = koaCtx.params
            // 使用 EJS 渲染，并传入变量
            const html = ejs.render(templateStr, {
                roomId,
                pageTitle: `KTV 房间 - ${roomId}`
            })
            koaCtx.type = 'html'
            koaCtx.body = html
        })

    }

	ctx.middleware(async (session, next) => {
		const elements = session.elements;
		if (
			cfg.openRepeat &&
			utils.detectControl(featureControl, session.guildId, "repeat")
		) {
			const content = session.content; //获取消息内容
			const ctxArr = repeatContextMap.get(session.gid); //获取上下文中存储的对话内容及次数
			if (!ctxArr || ctxArr[0] !== content) {
				//不存在上下文或两次消息不同
				//初始化/重置 存储到上下文中
				repeatContextMap.set(session.gid, [content, 1]);
			} else {
				//两次消息相同
				//times不为-1且times自加1之后大于设定的最小幅度次数
				//执行概率为repeatPossibility的随机布尔值
				if (
					ctxArr[1] !== -1 &&
					++ctxArr[1] >= cfg.minRepeatTimes &&
					Random.bool(cfg.repeatPossibility)
				) {
					//times置为-1防止重复复读
					ctxArr[1] = -1;
					await session.send(content); //复读
					//console.log(`"${content}"`);
				}
			}
		}

		if (
			cfg.atNotSay &&
			utils.detectControl(featureControl, session.guildId, "atNotSay")
		)
			await utils.atNotSayReply(cfg, session, elements);

		if (
			cfg.replyBot &&
			utils.detectControl(featureControl, session.guildId, "replyBot")
		)
			await utils.replyBot(cfg, session, elements);

		if (
			cfg.iLoveYou &&
			utils.detectControl(featureControl, session.guildId, "iLoveYou")
		)
			await utils.iLoveYou(cfg, session, elements);

		return next();
	});

	if (process.env.NODE_ENV === "development") {
		ctx.command("test [params]").action(async ({ session }) => {
			await session.send("test");
		});
		ctx.middleware(async (session, next) => {
			await session.send("");
			return next();
		});
	}

	function initAssets() {
		const defaultAssetsDir = path.join(__dirname, "../assets");

		// 直接给全局变量赋值
		assetsDir = path.join(ctx.baseDir, "data/starfx-bot/assets");

		if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

		const versionFile = path.join(assetsDir, "plugin_version.json");

		let localVersion = "0";
		if (fs.existsSync(versionFile)) {
			try {
				localVersion =
					JSON.parse(fs.readFileSync(versionFile, "utf-8")).version || "0";
			} catch {}
		}

		const pluginVersion = pkg.version;

		if (pluginVersion > localVersion) {
			try {
				if (fs.existsSync(defaultAssetsDir)) {
					fs.cpSync(defaultAssetsDir, assetsDir, {
						recursive: true,
						force: true,
					});
				}
				fs.writeFileSync(
					versionFile,
					JSON.stringify({ version: pluginVersion }),
				);
			} catch (err) {
				console.error("initAssets copy failed:", err);
			}
		}
	}
}
