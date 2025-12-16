import * as cheerio from "cheerio";
import { type Context, h, type Session } from "koishi";
import Parser from "rss-parser";

export async function getXUrl(urls: string) {
	const regex = /https:\/\/x\.com\/([^/]+)\/status\/(\d+)/g;
	let match: RegExpExecArray;
	const results: string[] = [];
	match = regex.exec(urls);
	do {
		// 在循环体内部，如果 match 仍然为 null，则跳过后续代码
		if (match === null) {
			break;
		}

		const [fullUrl] = match;
		results.push(fullUrl);

		match = regex.exec(urls);
	} while (match !== null);

	return results;
}

const parser = new Parser({
	customFields: {
		item: ["description", "link"],
	},
});

export async function getXNum(session: Session) {
	return session.content
		.trim()
		.split(" ")
		.slice(1)
		.filter((item) => !Number.isNaN(+item) && item)
		.map((str) => Number(str) - 1);
}

export async function getXImage(rssUrl: string, xUrls: string | string[]) {
	const xUrlsArray = Array.isArray(xUrls) ? xUrls : [xUrls];

	const feed = await parser.parseURL(rssUrl);
	const allImageUrls: string[] = [];

	for (const xUrl of xUrlsArray) {
		const item = feed.items.find((i) => i.link === xUrl);
		if (item) {
			const $ = cheerio.load(item.description);
			$("img").each((_, el) => {
				const src = $(el).attr("src");
				if (src) allImageUrls.push(src);
			});
		}
	}

	return allImageUrls;
}

export function chunk<T>(arr: T[], size: number): T[][] {
	const res: T[][] = [];
	for (let i = 0; i < arr.length; i += size) {
		res.push(arr.slice(i, i + size));
	}
	return res;
}

export async function sendImages(
	ctx: Context,
	session: Session,
	imageUrls: string[],
) {
	const chunks = chunk(imageUrls, 10);
	for (const group of chunks) {
		const messages = await Promise.all(
			group.map(async (url) => h.image(await getXImageBase64(ctx, url))),
		);
		if (messages.length > 0) {
			const message = messages.join("");
			await session.send(message);
		} else {
			await session.send(
				"未找到图片，请引用包含图片且处于RSS列表中的的推特链接",
			);
		}
	}
}

async function getXImageBase64(ctx: Context, url: string) {
	const res = await ctx.http.get(url, { responseType: "arraybuffer" });
	const base64 = Buffer.from(res).toString("base64");
	return `data:image/png;base64,${base64}`;
}
