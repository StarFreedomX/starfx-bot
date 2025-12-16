import * as fsp from "node:fs/promises";
import path from "node:path";
import type _sharp from "@quanhuzeyu/sharp-for-koishi";
import type { Sharp } from "@quanhuzeyu/sharp-for-koishi";
import { type Context, h } from "koishi";
import { assetsDir, baseDir, starfxLogger } from "../index";
import { getImageFromUrl } from "../utils";

/**
 * 将options的参数转换为drawBanGDreamBorder的配置
 * @param options
 * @return 适用于边框绘制的参数
 */
export async function handleBanGDreamConfig(options) {
	const types = {
		cool: ["cool", "blue", "蓝", "蓝色"],
		powerful: ["powerful", "red", "红", "红色"],
		pure: ["pure", "green", "绿", "绿色"],
		happy: ["happy", "orange", "橙", "橙色"],
	};
	const bands = {
		ppp: [
			"ppp",
			"poppin'Party",
			"破琵琶",
			"步品破茶",
			"poppin",
			"popipa",
			"poppinparty",
			"ポピパ",
		],
		ag: ["ag", "afterglow", "夕阳红", "悪蓋愚狼"],
		pp: [
			"pp",
			"pastel＊palettes",
			"pastel*palettes",
			"pastelPalettes",
			"怕死怕累",
			"pastel",
			"palettes",
			"pasupare",
			"パスパレ",
			"破巣照破烈斗",
		],
		hhw: [
			"hhw",
			"ハロー、ハッピーワールド！",
			"hello,happyworld!",
			"hellohappyworld",
			"ハロハピ",
			"hello，happyworld！",
			"harohapi",
			"破狼法被威悪怒",
			"儿歌团",
			"好好玩",
		],
		r: [
			"r",
			"roselia",
			"露世里恶",
			"萝",
			"露世裏悪",
			"ロゼリア",
			"r组",
			"相声团",
			"相声组",
		],
		ras: [
			"ras",
			"raiseasuilen",
			"raise",
			"suilen",
			"ラス",
			"零図悪酔恋",
			"睡莲",
			"麗厨唖睡蓮",
			"睡蓮",
		],
		mnk: [
			"mnk",
			"モニカ",
			"蝶团",
			"蝶",
			"morfonica",
			"毛二力",
			"monika",
			"monica",
		],
		go: [
			"go",
			"mygo!!!!!",
			"mygo！！！！！",
			"mygo",
			"我去！！！！！",
			"我去!!!!!",
			"我去",
			"卖狗",
		],
	};
	const trains = {
		color_star: ["花后", "1", "彩", "true"],
		normal_star: ["花前", "0", "false"],
	};
	const drawConfig = {
		color: "",
		band: "",
		starType: "",
		starNum: 0,
		border: "",
	};
	//处理color参数
	if (options?.color) {
		for (const [type, aliases] of Object.entries(types)) {
			if (aliases.includes(options.color.toLowerCase())) {
				drawConfig.color = type;
				break;
			}
		}
	}
	//处理band参数
	if (options?.band) {
		for (const [band, aliases] of Object.entries(bands)) {
			if (aliases.includes(options.band.toLowerCase())) {
				drawConfig.band = band;
				break;
			}
		}
	}
	// 处理 starNum 参数
	const starNum = options?.starNum ? parseInt(options.starNum, 10) : 0;
	drawConfig.starNum = starNum > 0 && starNum < 10 ? starNum : 0;

	// 处理 starType 参数
	if (options?.train) {
		for (const [train, aliases] of Object.entries(trains)) {
			if (aliases.includes(options.train.toLowerCase())) {
				drawConfig.starType = train;
				break;
			}
		}
	}
	return drawConfig;
}

/**
 * "封印"绘图功能
 * @param ctx Context
 * @param baseImage 被封印的图片url
 * @return 画完的图片 h对象
 */
export async function drawLock(ctx: Context, baseImage: string) {
	let image: Sharp;
	try {
		image = await getImageFromUrl(ctx, baseImage);
	} catch (error) {
		if (error.message === "Get image failed") {
			return "发生错误";
		} else if (error.message === "URL must be provided") {
			return "输入无效";
		} else {
			console.error(error.message);
		}
	}

	const sharp: typeof _sharp = ctx.QhzySharp.Sharp;
	const imageMetadata = await image.metadata();
	const lockUrl = `${baseDir}/data/starfx-bot/assets/lock.png`;
	const size1 = Math.min(imageMetadata.width, imageMetadata.height);
	image.resize({ width: size1, height: size1, fit: "cover" });
	const overlay = sharp(lockUrl).png();
	overlay.resize({ width: size1 });
	image.composite([{ input: await overlay.toBuffer() }]);
	return h.image(await image.png().toBuffer(), "image/png");
}

/**
 * "卖掉了"绘图函数
 * @param ctx
 * @param baseImage
 * @return 画完的图片 h对象
 */
export async function drawSold(ctx: Context, baseImage: string) {
	let image: Sharp;
	try {
		image = await getImageFromUrl(ctx, baseImage);
	} catch (error) {
		if (error.message === "Get image failed") {
			return "发生错误";
		} else if (error.message === "URL must be provided") {
			return "输入无效";
		} else {
			console.error(error.message);
		}
	}
	const sharp = ctx.QhzySharp.Sharp;
	const imageMetadata = await image.metadata();
	const size1 = Math.min(imageMetadata.width, imageMetadata.height);
	image.resize({ width: size1, height: size1, fit: "cover" });
	const middle = sharp({
		create: {
			width: size1,
			height: size1,
			channels: 4,
			background: { r: 255, g: 255, b: 255, alpha: 0.4 },
		},
	}).png();
	const soldUrl = `${assetsDir}/sold.png`;
	const overlay = sharp(soldUrl).png();
	const overlaySize = Math.round((size1 * 182) / 240);
	overlay.resize({
		width: overlaySize,
		height: overlaySize,
	});
	const topLeft = Math.round((overlaySize * 29) / 182);

	image.composite([
		{ input: await middle.toBuffer() },
		{
			input: await overlay.toBuffer(),
			top: topLeft,
			left: topLeft,
		},
	]);
	return h.image(await image.png().toBuffer(), "image/png");
}

/**
 * BanG Dream!边框绘制功能
 * @param ctx Koishi上下文
 * @param avatar 要绘制的底图
 * @param inputOptions 输入参数，接受color band starType starNum border
 */
export async function drawBanGDream(
	ctx: Context,
	avatar: string,
	inputOptions?: {
		color: string;
		band: string;
		starType: string;
		starNum: number;
		border: string;
	},
) {
	if (!avatar) return "";

	const colors = ["cool", "pure", "happy", "powerful"];
	const bands = ["ppp", "ag", "pp", "r", "hhw", "ras", "mnk", "go"];
	const starTypes = ["normal_star", "color_star"];
	const starNums = [1, 2, 3, 4, 5];

	const options = {
		color:
			inputOptions?.color || colors[Math.floor(Math.random() * colors.length)],
		band: inputOptions?.band || bands[Math.floor(Math.random() * bands.length)],
		starNum:
			inputOptions?.starNum ||
			starNums[Math.floor(Math.random() * starNums.length)],
		starType: inputOptions?.starType || "",
		border: inputOptions?.border || "",
	};

	options.starType ||=
		options.starNum < 3
			? starTypes[0]
			: starTypes[Math.floor(Math.random() * starTypes.length)];
	options.border ||= `card-${starNums.includes(options.starNum) ? options.starNum : 5}${options.starNum === 1 ? `-${options.color}` : ""}`;
	try {
		const zoom = 2;

		// 读取图片
		const [avatarSharp, colorBuffer, bandBuffer, starBuffer, borderBuffer] =
			await Promise.all([
				getImageFromUrl(ctx, avatar),
				fsp.readFile(
					path.join(assetsDir, "bangborder", `${options.color}.png`),
				),
				fsp.readFile(path.join(assetsDir, "bangborder", `${options.band}.png`)),
				fsp.readFile(
					path.join(assetsDir, "bangborder", `${options.starType}.png`),
				),
				fsp.readFile(
					path.join(assetsDir, "bangborder", `${options.border}.png`),
				),
			]);
		const sharp: typeof _sharp = ctx.QhzySharp.Sharp;
		// avatar cover 500*zoom
		let image = avatarSharp.resize(500 * zoom, 500 * zoom, { fit: "cover" });

		// border cover 500*zoom
		const borderImage = await sharp(borderBuffer)
			.resize(500 * zoom, 500 * zoom, { fit: "cover" })
			.toBuffer();

		// color cover 130*zoom
		const colorImage = await sharp(colorBuffer)
			.resize(130 * zoom, 130 * zoom, { fit: "cover" })
			.toBuffer();

		// band resize 保持比例
		let bandSharp = sharp(bandBuffer);
		const bandMeta = await bandSharp.metadata();
		if (bandMeta.width !== undefined && bandMeta.height !== undefined) {
			if (bandMeta.width > bandMeta.height) {
				bandSharp = bandSharp.resize({ width: Math.round(120 * zoom) });
			} else {
				bandSharp = bandSharp.resize({ height: Math.round(120 * zoom) });
			}
		} else {
			starfxLogger.warn(
				"Sharp metadata missing width or height. Skipping resize logic.",
			);
			return "无法识别图片Metadata";
		}
		const bandImage = await bandSharp.toBuffer();

		// star resize 90*zoom
		const starImage = await sharp(starBuffer)
			.resize({ width: Math.round(90 * zoom) })
			.toBuffer();

		const starComposites = Array.from({ length: options.starNum }, (_, i) => ({
			input: starImage,
			left: Math.round(10 * zoom),
			top: Math.round(410 * zoom - i * 60 * zoom),
		}));

		image = image.composite([
			// composite border
			{ input: borderImage, left: 0, top: 0 },
			// composite color
			{
				input: colorImage,
				left: Math.round(500 * zoom - 130 * zoom - 3 * zoom),
				top: 6,
			},
			// composite band
			{
				input: bandImage,
				left: Math.round(15 * zoom),
				top: Math.round(15 * zoom),
			},
			// composite stars
			...starComposites,
		]);
		const buffer = await image.png().toBuffer();
		return `data:image/png;base64,${buffer.toString("base64")}`;
	} catch (err) {
		console.error(err);
		return "";
	}
}
