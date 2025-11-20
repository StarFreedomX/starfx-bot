import Parser from "rss-parser";
import { h, Session } from "koishi";
import * as cheerio from "cheerio";
import { Config } from "../index";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import axios from "axios";

export async function getXUrl(urls: string){
  const regex = /https:\/\/x\.com\/([^\/]+)\/status\/(\d+)/g;
  let match;
  const results = [];

  while ((match = regex.exec(urls)) !== null) {
    const [fullUrl] = match;
    results.push(fullUrl);
  }
  // console.log(results);
  return results;
}

const parser = new Parser({
  customFields: {
    item: ['description', 'link']
  }
});

export async function getXNum(session: Session){
  return session.content.trim().split(' ').slice(1).filter(item => !isNaN(+item) && item).map(str => Number(str) - 1);
}

export async function getXImage(rssUrl: string, xUrls: string | string[]){
  const xUrlsArray = Array.isArray(xUrls) ? xUrls : [xUrls]

  const feed = await parser.parseURL(rssUrl);
  const allImageUrls: string[] = [];

  for (const xUrl of xUrlsArray) {
    const item = feed.items.find(i => i.link === xUrl);
    if (item) {
      const $ = cheerio.load(item.description);
      $('img').each((_, el) => {
        const src = $(el).attr('src');
        if (src) allImageUrls.push(src);
      });
    }
  }

  return allImageUrls;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const res: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    res.push(arr.slice(i, i + size))
  }
  return res
}

export async function sendImages(session: Session, cfg:Config, imageUrls: string[]) {
  const chunks = chunk(imageUrls, 10)
  for (const group of chunks) {
    const messages = await Promise.all(
      group.map(async (url) => h.image(await getXImageBase64(url, cfg)))
    )
    if(messages.length > 0) {
      const message = messages.join('')
      await session.send(message)
    }else{
      await session.send('未找到图片，请引用包含图片且处于RSS列表中的的推特链接')
    }
  }
}

async function getXImageBase64(url: string, cfg: Config) {
  const httpAgent = new HttpProxyAgent(cfg.proxyUrl);
  const httpsAgent = new HttpsProxyAgent(cfg.proxyUrl);
  axios.defaults.httpAgent = httpAgent;
  axios.defaults.httpsAgent = httpsAgent;
  const res = await axios.get(url,{responseType:'arraybuffer'})
  const base64 = Buffer.from(res.data, 'binary').toString('base64')
  const dataUrl = `data:image/png;base64,${base64}`
  console.log('success')
  return dataUrl;
}
