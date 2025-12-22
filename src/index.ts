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
    ktvServer: boolean;

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
        ktvServer: Schema.boolean().default(false).description('开启ktv web服务器，访问地址是"<a href="/songRoom">koishi地址/songRoom</a>"')
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

    if (cfg.ktvServer && ctx.cache && ctx.server) {
        // 预读模板文件
        const templatePath = path.resolve(assetsDir,'./songRoom.ejs')
        let templateStr = fs.readFileSync(templatePath, 'utf-8')

        // 严格校验 roomId
        const ROOM_ID_REGEX = /^[a-zA-Z0-9_-]{1,20}$/;
        const CACHE_EXPIRE_TIME = 24 * 60 * 60 * 1000;

        // 缓存变量，按 roomId 分隔
        const roomOpCache: Record<string, OpLog[]> = {}
        const roomSongsCache: Record<string, Song[]> = {}

        // --- 修改 1：生成哈希工具函数 ---
        function getHash(songs) {
            if (!songs || songs.length === 0) return "EMPTY_LIST_HASH"; // 给空列表一个固定标识
            const str = songs.map(s => `${s.id}:${s.title}`).join('|');
            // 使用你喜欢的哈希算法，如 md5
            return crypto.createHash('md5').update(str).digest('hex');
        }

        // 每 5 分钟检测并清理 5 分钟前的缓存
        ctx.setInterval(() => {
            const now = Date.now();
            for (const roomId in roomOpCache) {
                roomOpCache[roomId] = roomOpCache[roomId].filter(log => now - log.timestamp < 5 * 60 * 1000);
                if (!roomOpCache[roomId]?.length) {
                    delete roomOpCache[roomId];
                    delete roomSongsCache[roomId];
                }
            }
        }, 5 * 60 * 1000);


        // 获取歌曲列表及当前哈希
        ctx.server.get('/songRoom/api/songListInfo', async (koaCtx) => {
            const { roomId: roomIds, lastHash: clientHashs } = koaCtx.query;
            const roomId = Array.isArray(roomIds) ? roomIds.at(0) : roomIds;
            const clientHash = Array.isArray(clientHashs) ? clientHashs.at(0) : clientHashs;
            // 初始化歌曲缓存 (确保不是 undefined)
            if (!roomSongsCache[roomId]) {
                const dbData = await ctx.cache.get("ktv_room", roomId);
                roomSongsCache[roomId] = dbData || [];
            }

            const currentSongs = roomSongsCache[roomId];
            const serverHash = getHash(currentSongs);

            // 初始化 OpLog 缓存 (重要：空列表也需要一个基础 Log 作为操作起点)
            if (!roomOpCache[roomId] || roomOpCache[roomId].length === 0) {
                roomOpCache[roomId] = [{
                    idArray: currentSongs.map(s => s.id),
                    hash: serverHash,
                    song: null,
                    toIndex: -1,
                    timestamp: Date.now()
                }];
            }

            // clientHash 为空或不匹配时 下发全量
            if (clientHash && clientHash === serverHash) {
                return koaCtx.body = { changed: false, hash: serverHash };
            }

            koaCtx.body = {
                changed: true,
                list: currentSongs,
                hash: serverHash
            };
        });

        // Move/Add/Delete 逻辑
        ctx.server.post('/songRoom/api/songOperation', async (koaCtx) => {
            const { roomId: roomIds} = koaCtx.query;
            const roomId = Array.isArray(roomIds) ? roomIds.at(0) : roomIds;
            if (!ROOM_ID_REGEX.test(roomId)) {
                return koaCtx.body = { success: false, msg: 'Invalid Room ID' };
            }
            const body = koaCtx.request["body"];
            const { idArrayHash, song, toIndex } = body;

            if (song && song.url && song.url.includes('b23.tv')) {
                const bvid = await resolveBilibiliBV(song.url);
                if (bvid) {
                    // 将 url 替换为提取出的 BV 号（或者完整的 bilibili:// 协议）
                    // 这样存入缓存和下发给其他客户端时，就是最纯净的数据
                    song.url = `bilibili://video/${bvid}`;
                    // 如果你的 song 对象里有 id 字段，通常建议保持一致
                    if (!song.id) song.id = bvid;
                }
            }

            // 确保缓存存在，防止服务器重启后第一个请求是 POST 导致报错
            if (!roomSongsCache[roomId]) {
                roomSongsCache[roomId] = (await ctx.cache.get("ktv_room", roomId) || []);
            }

            // 如果 OpLog 丢了，手动补一个基于当前内存状态的底座
            if (!roomOpCache[roomId]) {
                roomOpCache[roomId] = [{
                    idArray: roomSongsCache[roomId].map(s => s.id),
                    hash: getHash(roomSongsCache[roomId]),
                    song: null,
                    toIndex: -1,
                    timestamp: Date.now()
                }];
            }

            const logs = roomOpCache[roomId];
            const hitIdx = logs.findIndex(l => l.hash === idArrayHash);

            // REJECT 逻辑：如果前端传来的 Hash 在日志里找不到
            // 可能是因为服务器重启导致 Log 丢失，或者前端落后太多
            if (hitIdx === -1) {
                return koaCtx.body = { success: false, code: 'REJECT' };
            }

            const baseLog = logs[hitIdx];
            const spotIds = [...baseLog.idArray];
            const nowSongs = [...roomSongsCache[roomId]]; // 浅拷贝一份防止污染

            const currentOp = {
                idArray: [],
                hash: '',
                song: song,
                toIndex: toIndex,
                timestamp: Date.now()
            };

            const laterOps = [...logs.slice(hitIdx + 1), currentOp];

            try {
                // 执行重演逻辑
                const finalSongs = songOperation(nowSongs, spotIds, laterOps);
                const finalIds = finalSongs.map(s => s.id);
                const finalHash = getHash(finalSongs);

                currentOp.idArray = finalIds;
                currentOp.hash = finalHash;
                logs.push(currentOp);

                // 保持日志长度，防止内存溢出（只保留最近 50 条操作记录）
                if (logs.length > 50) logs.shift();

                roomSongsCache[roomId] = finalSongs;
                await ctx.cache.set(`ktv_room`, roomId, finalSongs, CACHE_EXPIRE_TIME);

                koaCtx.body = { success: true, hash: finalHash, song };
            } catch (e) {
                console.error("Operation re-run failed:", e);
                koaCtx.body = { success: false, code: 'REJECT' };
            }
        });


        resolveBilibiliBV("https://b23.tv/GYKSqTa").then((value)=>console.log(value))


        /**
         * 解析 B23.TV 短链接并提取 BV 号
         * @param {string} inputUrl
         * @returns {Promise<string|null>} 返回提取到的 BV 号
         */
        async function resolveBilibiliBV(inputUrl: string): Promise<string> {
            // 基础校验：必须是 b23.tv 的链接
            if (!inputUrl.includes('b23.tv')) {
                // 如果输入已经是原始链接，直接尝试从输入提取
                return extractBV(inputUrl);
            }
            try {
                // 发起请求，禁止自动重定向
                const response = await ctx.http(inputUrl, {
                    redirect: 'manual',
                    validateStatus: (status) => status >= 200 && status < 400,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/004.1'
                    }
                });

                let targetUrl = response?.headers?.get('location');

                return extractBV(targetUrl);

            } catch (error) {
                // 处理 axios 在 302 时可能抛出的异常
                const loc = error.response?.headers?.location;
                if (loc) return extractBV(loc);

                console.error('解析 B23 短链接失败:', error.message);
                return null;
            }
        }

        /**
         * 正则提取 BV 号
         */
        function extractBV(url: string) {
            if (!url) return null;
            const match = url.match(/(BV[a-zA-Z0-9]{10})/);
            return match ? match[0] : null;
        }

        function songOperation(nowSongs: Song[], songIdArray: string[], ops: OpLog[]): Song[] {
            /*
            实现逻辑：首先构造双向链表
            HEAD <-> 0 <-> A <-> 1 <-> B <-> 2 <-> C <-> 3 <-> D <-> 4 <-> E <-> 5 <-> F <-> 6 <-> G <-> 7 <-> TAIL
            对于接下来的Ops采用双向链表操作实现
            op1: A -> 4
            op2: B -> 6
            ...
            那么将很简单，让 A 的前后元素相连变为 0 <-> 1
            然后把prev(4) <-> 4 改为 prev(4) <-> A <-> 4 ......
            以此类推
             */

            // 构建最新的 Song 状态池
            const latestSongMap = new Map<string, Song>();

            // 初始数据判空
            if (Array.isArray(nowSongs)) {
                nowSongs.forEach(s => s && s.id && latestSongMap.set(s.id, s));
            }

            // 更新状态池，增加 op 和 song 的安全校验
            [...ops].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
                .forEach(op => {
                    if (op?.song?.id && op.toIndex !== -1) {
                        latestSongMap.set(op.song.id, op.song);
                    }
            });

            //双向链表处理
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

                // 创建/重用节点
                if (!node) {
                    node = new ListNode(song.id);
                    idNodes.set(song.id, node);
                }

                // 安全挂载到锚点
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

            // 转换回数组
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
            if (process.env.NODE_ENV === "development") {
                console.log('loading template')
                const templatePath = path.resolve(__dirname, '../assets/songRoom.ejs')
                templateStr = fs.readFileSync(templatePath, 'utf-8')
            }
            const { roomId } = koaCtx.params
            const urlPath = koaCtx.path;
            // 检查路径末尾是否有斜杠
            if (urlPath.endsWith('/')) {
                koaCtx.status = 301;
                // 加上斜杠并保留 query 参数（如 ?from=xxx）
                koaCtx.redirect(urlPath.slice(0,-1) + koaCtx.search);
                return;
            }
            // 使用 EJS 渲染，并传入变量
            const html = ejs.render(templateStr, {
                roomId,
                pageTitle: `KTV 房间 - ${roomId}`
            })
            koaCtx.type = 'html'
            koaCtx.body = html
        })

        // 默认入口页面：输入房间号
        ctx.server.get('/songRoom', async (koaCtx) => {
            koaCtx.type = 'html';
            const urlPath = koaCtx.path;
            // 检查路径末尾是否有斜杠
            if (!urlPath.endsWith('/')) {
                koaCtx.status = 301;
                // 加上斜杠并保留 query 参数（如 ?from=xxx）
                koaCtx.redirect(urlPath + '/' + koaCtx.search);
                return;
            }
            koaCtx.body = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>进入 KTV 房间</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
            @keyframes slideUp {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }
            .animate-pop { animation: slideUp 0.5s ease-out; }
        </style>
    </head>
    <body class="bg-slate-50 min-h-screen flex items-center justify-center p-6 text-slate-900">
        <div class="w-full max-w-sm bg-white p-8 rounded-[2.5rem] shadow-xl border border-slate-100 animate-pop">
            <header class="text-center mb-8">
                <h1 class="text-4xl font-black text-indigo-600 mb-2">KTV Queue</h1>
                <p class="text-slate-400 font-medium">输入房间号进入房间</p>
            </header>

            <div class="space-y-4">
                <input id="roomInput" type="text" maxlength="10"
                    class="w-full px-6 py-4 bg-slate-50 rounded-2xl text-center text-2xl font-bold tracking-widest outline-none focus:ring-4 focus:ring-indigo-100 transition-all border-2 border-transparent focus:border-indigo-400"
                    placeholder="0000" autofocus>

                <button onclick="joinRoom()"
                    class="w-full py-4 bg-indigo-600 text-white text-lg font-bold rounded-2xl hover:bg-indigo-700 active:scale-95 transition-all shadow-lg shadow-indigo-100">
                    进入房间
                </button>
            </div>

            <p class="text-center text-slate-300 text-xs mt-8 uppercase tracking-widest font-bold">Powered by StarFreedomX</p>
        </div>

        <script>
            function joinRoom() {
                const id = document.getElementById('roomInput').value.trim();
                if (id) window.location.href = id;
            }

            // 支持回车键跳转
            document.getElementById('roomInput').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') joinRoom();
            });
        </script>
    </body>
    </html>
    `;
        });

        // 这段代码必须放在所有 ctx.server.get/post 逻辑的最下方
        ctx.server.all('/songRoom/(.*)', async (koaCtx, next) => {
            // 如果执行到了这里，说明前面的路由（如 /songRoom/:roomId）都没匹配上
            // 直接返回 404 错误，不调用 next()
            koaCtx.status = 404;
            koaCtx.body = '404 Not Found - 路径错误';
            // 不调用 next()，Koishi 的控制台逻辑就不会被触发
        });
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
