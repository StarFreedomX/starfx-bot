import {Context, h, Random, Session} from "koishi";
import fs from "fs";
import path from "node:path";
import sharp from "sharp";
import {Jimp} from "jimp";
import {assetsDir, baseDir, Config, recordLink, starfxLogger} from "./index";
import Parser from 'rss-parser';
import 'chartjs-adapter-dayjs-3';
import * as cheerio from 'cheerio';
import {HttpProxyAgent} from "http-proxy-agent";
import {HttpsProxyAgent} from "https-proxy-agent";
import axios from "axios";
import {Chart, ChartItem, registerables,} from 'chart.js';
import {Canvas} from 'skia-canvas';

Chart.register(
  ...registerables
);


//功能控制
interface FeatureControl {
  [feature: string]: {
    whitelist: boolean
    groups: number[]
  }
}


interface tagConfig{
  [gid: string]: string[]
}

/**
 * 添加投稿
 * @param ctx Context
 * @param gid 当前群组的gid，注意需要把:替换为_等其它字符
 * @param avatarUrl 图片的Url网络地址
 */
export async function addRecord(ctx: Context, gid: string, avatarUrl: string): Promise<string> {
  const recordDir = `${assetsDir}/record/${gid}`;
  const avatarBuffer = await ctx.http.get(avatarUrl, {responseType: 'arraybuffer'});
  saveImage(avatarBuffer, recordDir);
  return '投稿收到啦'
}

/**
 * 从当前群组的语录中随机获取一张，同样需要把gid的:替换为_
 * @param cfg
 * @param gid
 * @param tag
 * @return 图片的文件路径
 */
export async function getRecord(cfg: Config, gid: string, tag: string): Promise<string | null> {

  const links = structuredClone(cfg.recordLink);
  links[gid] = {linkGroup:gid,linkWeight:100};
  const selectGid = getRandomLinkGroup(links).replaceAll(':', '_')
  // console.log(selectGid)
  const recordDir = path.join(assetsDir, "record", selectGid);
  const tagConfigPath = path.join(assetsDir, "tagConfig", `${selectGid}.json`);
  if (!fs.existsSync(recordDir)) return null;

  const files = fs.readdirSync(recordDir).filter(file => /\.(png|jpe?g|webp|gif)$/i.test(file));
  if (!files.length) return null;

  const tagConfigJson: tagConfig = fs.existsSync(tagConfigPath)
    ? JSON.parse(fs.readFileSync(tagConfigPath, "utf8") || "{}")
    : {};

  // 构造带权重的条目
  const weighted: { file: string; weight: number }[] = files.map(file => {
    const name = path.parse(file).name;
    const tags = tagConfigJson[name] || [];
    const weight = tag && tags.includes(tag) ? cfg.tagWeight : 1;
    return { file, weight };
  });

  // 加权随机选择
  const totalWeight = weighted.reduce((acc, cur) => acc + cur.weight, 0);//求和
  let rand = Math.random() * totalWeight;//随机

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
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

/**
 * 获取当前目录下特定`前缀+{数字}.后缀名`的{数字}的最大值+1
 * @param directory 检索的目录
 * @param prefix 前缀
 * @param suffix 后缀（可选，默认jpg）
 * @return 当前被使用的序列最大值+1
 */
export function getNextSequenceNumber(directory: string, prefix: string, suffix: string = 'jpg'): number {
  const files = fs.existsSync(directory) ? fs.readdirSync(directory) : [];
  const regex = new RegExp(`^${prefix}-(\\d+)\\.${suffix}$`);
  let maxNum = 0;
  files.forEach(file => {
    const match = file.match(regex);
    if(match){
      const num = parseInt(match[1], 10);
      if (num > maxNum) {
        maxNum = num;
      }
    }
  })
  return maxNum + 1;
}

/**
 * 保存图片到本地
 * @param arrayBuffer 传入的buffer，注意是arraybuffer
 * @param directory 保存的目录
 * @param filename 文件名 默认为yyyyMMdd-{num}.jpg
 */
export function saveImage(arrayBuffer: ArrayBuffer, directory: string, filename?: string) {
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
export async function getImageSrc(session: Session, param: string, option?:{
  number?: boolean,
  img?: boolean,
  at?: boolean,
  noParam?: boolean,
  quote?: boolean,
}): Promise<string>
{
  const
    number = option?.number ?? true,
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

  if(quote){
    //引用的消息中选择
    const quoteElementArray = session?.quote?.elements;
    if (quoteElementArray?.length) {
      for (const element of quoteElementArray) {
        if (img && element?.type === 'img') {
          //console.log(element?.attrs?.src.slice(0,1000))
          return element?.attrs?.src;
        } else if (at && element?.type === 'at' && element?.attrs?.id && element.attrs.id !== session.selfId) {
          return `https://q1.qlogo.cn/g?b=qq&nk=${element?.attrs?.id}&s=640`;
        }
      }
    }
  }
  //发送的消息中选择
  const elementArray = session.elements;
  for (const element of elementArray) {
    if (img && element?.type === 'img') {
      return element?.attrs?.src;
    } else if (at && element?.type === 'at' && element?.attrs?.id) {
      return `https://q1.qlogo.cn/g?b=qq&nk=${element.attrs.id}&s=640`;
    }
  }
  //没有那么返回空值
  return '';

}

/**
 * 将options的参数转换为drawBanGDreamBorder的配置
 * @param options
 * @return 适用于边框绘制的参数
 */
export async function handleBanGDreamConfig(options) {
  const types = {
    cool: ['cool', 'blue', '蓝', '蓝色'],
    powerful: ['powerful', 'red', '红', '红色'],
    pure: ['pure', 'green', '绿', '绿色'],
    happy: ['happy', 'orange', '橙', '橙色'],
  }
  const bands = {
    ppp: ['ppp', 'poppin\'Party', '破琵琶', '步品破茶', 'poppin', 'popipa', 'poppinparty', 'ポピパ'],
    ag: ['ag', 'afterglow', '夕阳红', '悪蓋愚狼'],
    pp: ['pp', 'pastel＊palettes', 'pastel*palettes', 'pastelPalettes', '怕死怕累', 'pastel', 'palettes', 'pasupare', 'パスパレ', '破巣照破烈斗'],
    hhw: ['hhw', 'ハロー、ハッピーワールド！', 'hello,happyworld!', 'hellohappyworld', 'ハロハピ', 'hello，happyworld！', 'harohapi', '破狼法被威悪怒', '儿歌团', '好好玩'],
    r: ['r', 'roselia', '露世里恶', '萝', '露世裏悪', 'ロゼリア', 'r组', '相声团', '相声组'],
    ras: ['ras', 'raiseasuilen', 'raise', 'suilen', 'ラス', '零図悪酔恋', '睡莲', '麗厨唖睡蓮', '睡蓮'],
    mnk: ['mnk', 'モニカ', '蝶团', '蝶', 'morfonica', '毛二力', 'monika', 'monica'],
    go: ['go', 'mygo!!!!!', 'mygo！！！！！', 'mygo', '我去！！！！！', '我去!!!!!', '我去', '卖狗']
  }
  const trains = {
    'color_star': ['花后', '1', '彩', 'true'],
    'normal_star': ['花前', '0', 'false']
  }
  const drawConfig = {
    color: '',
    band: '',
    starType: '',
    starNum: 0,
    border: '',
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
  const starNum = options?.starNum ? parseInt(options.starNum) : 0;
  drawConfig.starNum =  starNum > 0 && starNum < 10 ? starNum : 0;

  // 处理 starType 参数
  if (options?.train){
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
  const image = await getImageFromUrl(ctx, baseImage);
  if (image === -1) {
    return '发生错误'
  } else if (image === -2) {
    return '输入无效'
  }
  const imageMetadata = await image.metadata();
  const lockUrl = `${baseDir}/data/starfx-bot/assets/lock.png`;
  const size1 = Math.min(imageMetadata.width, imageMetadata.height);
  image.resize({width: size1, height: size1, fit: 'cover'})
  const overlay = sharp(lockUrl).png();
  overlay.resize({width: size1});
  image.composite([{input: await overlay.toBuffer()}]);
  return h.image(await image.png().toBuffer(), "image/png");
}

/**
 * "卖掉了"绘图函数
 * @param ctx
 * @param baseImage
 * @return 画完的图片 h对象
 */
export async function drawSold(ctx: Context, baseImage: string) {
  const image = await getImageFromUrl(ctx, baseImage);
  if (image === -1) {
    return '发生错误'
  } else if (image === -2) {
    return '输入无效'
  }
  const imageMetadata = await image.metadata();
  const size1 = Math.min(imageMetadata.width, imageMetadata.height);
  image.resize({width: size1, height: size1, fit: 'cover'})
  const middle = sharp({
    create: {
      width: size1,
      height: size1,
      channels: 4,
      background: {r: 255, g: 255, b: 255, alpha: 0.4},
    }
  }).png();
  const soldUrl = `${assetsDir}/sold.png`;
  const overlay = sharp(soldUrl).png();
  const overlaySize = Math.round(size1 * 182 / 240)
  overlay.resize({
    width: overlaySize,
    height: overlaySize,
  });
  const topLeft = Math.round(overlaySize * 29 / 182)

  image.composite([
    {input: await middle.toBuffer()},
    {
      input: await overlay.toBuffer(),
      top: topLeft,
      left: topLeft,
    }
  ]);
  return h.image(await image.png().toBuffer(), "image/png");
}

/**
 * 从url下载图片并返回sharp对象
 * @param ctx Context
 * @param url 要下载的图片url
 * @return sharp对象或数字 -2代表url为空 -1代表下载异常
 */
export async function getImageFromUrl(ctx: Context, url: string) {
  if (!url) return -2;

  let image: sharp.Sharp;
  const config = {
    responseType: 'arraybuffer' as 'arraybuffer'
  }
  try {
    image = sharp(await ctx.http.get(url, config)).png();
  } catch (err) {
    console.error(err);
    return -1;
  }
  return image;
}

/**
 * at不说话功能实现
 * @param cfg Koishi插件配置
 * @param session 当前会话Session对象
 * @param elements 当前消息elements
 */
export async function atNotSayReply(cfg: Config, session: Session, elements: h[]) {
  const trimElements = elements.filter(e => !(e.type === 'text' && /^\s*$/.test(e.attrs.content)))
  //console.log(trimElements);
  // 处理仅包含at的情况
  if ((cfg.atNotSay || cfg.atNotSayOther) &&
    trimElements.length === 1 &&
    trimElements[0].type === 'at') {

    const isAtSelf = trimElements[0].attrs.id === session.selfId;

    if (isAtSelf && cfg.atNotSay && Random.bool(cfg.atNotSayProperty)) {
      await session.send(session.text('middleware.messages.atNotReply'));
    } else if (!isAtSelf && cfg.atNotSayOther && Random.bool(cfg.atNotSayOtherProperty)) {
      await session.send(session.text('middleware.messages.atNotReplyOther'));
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
  if (cfg.replyBot !== '关闭') {
    const bots = ['bot', '机器人', 'Bot', 'BOT', '机器人！', '机器人!', '人机'];
    const texts = elements?.filter(e => e.type === 'text').map(e => e?.attrs?.content?.trim());
    const ats = elements?.filter(e => e.type === 'at').map(e => e?.attrs?.id);

    const mentionedBot = texts?.some(t => bots.includes(t));
    const atMe = ats?.includes(session.selfId);

    if ((elements?.length === 1 && mentionedBot && cfg.replyBot === '无需at') ||
      (elements?.length === 2 && mentionedBot && atMe)) {
      await session.send(session.text('middleware.messages.notBot'));
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
    const hasAtMe = elements?.some(e => e.type === 'at' && e?.attrs?.id === session.selfId);
    const hasLoveMessage = elements?.some(e =>
      e.type === 'text' && e?.attrs?.content?.trim() === session.text('middleware.messages.loveMessage')
    );

    if (elements?.length === 2 && hasAtMe && hasLoveMessage) {
      await session.send(session.text('middleware.messages.iLoveU', {
        at: h.at(session.userId),
        quote: h.quote(session.messageId)
      }));
    }
  }
}

/**
 * BanG Dream!边框绘制功能
 * @param avatar 要绘制的底图
 * @param inputOptions 输入参数，接受color band starType starNum border
 */
export async function drawBanGDream(avatar: string, inputOptions?: {
  color: string,
  band: string,
  starType: string,
  starNum: number,
  border: string,
})
{
  if (!avatar) {
    return ''
  }
  const colors = ['cool', 'pure', 'happy', 'powerful'];
  const bands = ['ppp', 'ag', 'pp', 'r', 'hhw', 'ras', 'mnk', 'go'];
  const starTypes = ['normal_star', 'color_star'];
  const starNums = [1, 2, 3, 4, 5];
  //const borders = ['card-1', 'card-2', 'card-3', 'card-4', 'card-5'];
  const options = {
    color: inputOptions.color || Random.pick(colors),
    band: inputOptions.band || Random.pick(bands),
    starNum: inputOptions.starNum || Random.pick(starNums),
    starType: inputOptions.starType || '',
    border: inputOptions.border || '',
  }
  options.starType ||= options.starNum < 3 ? starTypes[0] : Random.pick(starTypes);
  options.border ||= `card-${starNums.includes(options.starNum) ? options.starNum : 5}${options.starNum == 1 ? `-${options.color}` : ''}`;

  let image;
  try{
    image = await Jimp.read(avatar);
  }catch (e){
    starfxLogger.error(e);
    return;
  }
  const [colorImage, bandImage, starImage, borderImage] = await Promise.all([
    Jimp.read(`${assetsDir}/bangborder/${options.color}.png`),
    Jimp.read(`${assetsDir}/bangborder/${options.band}.png`),
    Jimp.read(`${assetsDir}/bangborder/${options.starType}.png`),
    Jimp.read(`${assetsDir}/bangborder/${options.border}.png`),
  ]);

  const zoom = 2.0;

  image.cover({w: 500 * zoom, h: 500 * zoom});
  borderImage.cover({w: 500 * zoom, h: 500 * zoom});
  image.composite(borderImage);
  colorImage.cover({w: 130 * zoom, h: 130 * zoom});
  image.composite(colorImage, image.width - colorImage.width - 3 * zoom, 5.5);
  bandImage.width > bandImage.height ? bandImage.resize({w: 120 * zoom}) : bandImage.resize({h: 120 * zoom});
  image.composite(bandImage, 15 * zoom, 15 * zoom);
  starImage.resize({w: 90 * zoom});
  const step = 60 * zoom;
  let hei = 410 * zoom;
  let times = options.starNum;
  while (times > 0) {
    image.composite(starImage, 10 * zoom, hei);
    hei -= step;
    times--;
  }
  return `data:image/png;base64,${(await image.getBuffer("image/jpeg")).toString("base64")}`;
}

export async function intervalGetExchangeRate(ctx: Context, cfg: Config, session: Session, searchString: string, exchangeRatePath: string) {
  // TODO
}

async function parseNaturalCurrency(searchString: string): Promise<string | null> {
  const index = await getCurrencyCodesMap()
  const s = searchString.replace(/\s+/g, '')

  // A. 解析 “xxx兑yyy” / “xxx对yyy”
  const match = s.match(/(.+?)(兑|对)(.+)/)
  if (match) {
    const from = index[match[1]]
    const to = index[match[3]]

    if (from && to) {
      return from + to  // 生成如 JPNCNY / USDCNY
    }
  }

  if (index[s]) {
    return index[s]
  }
  return null
}
export async function getExchangeRate(ctx: Context, cfg: Config, session: Session, searchString?: string, raw?: string, retryTimes = 1) {
  const apiKey = retryTimes ? await getMvpAPIKey() : await updateMvpAPIKey();
  try {
    let guids: string[] = [];
    // 尝试中文解析
    if (searchString) {
      const parsed = await parseNaturalCurrency(searchString)
      if (parsed) {
        searchString = parsed
      }
    }

    if (raw && /^([a-z0-9]{6})([,\s]([a-z0-9]{6}))*$/.test(raw)){
      guids = raw.split(',');
    } else if (/^([a-zA-Z]{3}|[a-zA-Z]{6})([,\s]([a-zA-Z]{3}|[a-zA-Z]{6}))*$/.test(searchString)){
      const currencies = await getCurrencyCodes(); // 返回 [{CurrencyCode: "CNY"}, ...]
      // 拆分字符串为单个6位代码
      const codes = searchString.split(/[,\s]+/);
      // 收集不合法的代码
      const invalidCodes: string[] = [];
      let search6Strings = [];
      codes.forEach(code => {
        const first = code.slice(0, 3).toUpperCase();
        const second = code.length === 3 ? 'CNY' : code.slice(3, 6).toUpperCase();
        search6Strings.push(code.length === 3 ? first + second : code);
        if (!currencies.some(c => c.code === first)) invalidCodes.push(first);
        if (code.length === 6 && !currencies.some(c => c.code === second)) invalidCodes.push(second);
      });

      if (invalidCodes.length > 0) {
        throw new Error(`输入的货币代码不合法: ${invalidCodes.join(', ')}`);
      }
      guids = await getExchangeGuids(search6Strings.join(','), apiKey);
    }


    // guids 如果全是空字符串，就说明 symbol 无效
    if (!guids.length || guids.every(g => !g)) {
      throw new Error(`输入无效: ${searchString}`);
    }

    const result: { name: string; nowPrice: number; fromCurrency: string; currency: string; oneMonthChart: h }[] = [];

    for (const guid of guids) {
      if (!guid) throw new Error("GUID not found");

      const nowPriceArr = await getQuotes(guid, apiKey);
      const monthPriceArr = await getMonthMSNClosePrices(guid, apiKey);
      const nowPrice = nowPriceArr?.[0];
      const oneMonthPrice = monthPriceArr?.[0];

      if (!nowPrice || !oneMonthPrice) {
        throw new Error("Failed to fetch price");
      }

      const chartBuffer = await drawOneMonthChartSkia(oneMonthPrice.prices, oneMonthPrice.timeStamps, `1 ${nowPrice.fromCurrency} to 1 ${nowPrice.currency}`);
      const imgSrc = "data:image/png;base64," + chartBuffer.toString("base64");

      result.push({
        name: nowPrice.symbolName,
        fromCurrency: nowPrice.fromCurrency,
        currency: nowPrice.currency,
        nowPrice: nowPrice.price,
        oneMonthChart: h.image(imgSrc),
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
近30天价格走势:
`),
        item.oneMonthChart
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
    }else{
      await getExchangeRate(ctx, cfg, session, searchString, raw, retryTimes-1);
    }
  }
}


export function parseJsonControl(text: string): FeatureControl | null {
  try {
    return JSON.parse(text);
  } catch (e) {
    starfxLogger.warn('[功能控制] JSON 解析失败')
    return null;
  }
}

export function detectControl(controlJson: FeatureControl, guildId: string, funName: string) {
  const rule = controlJson?.[funName];
  if (!rule || rule.whitelist === undefined || !Array.isArray(rule.groups)) {
    return true; // 未配置或配置无效 -> 默认允许
  }
  const inList = rule.groups.includes(Number(guildId));
  return rule.whitelist ? inList : !inList
}

export function handleRoll(session: Session) {

  // 提取元素内容
  const elements = session.elements;
  let parts = [];

  // 处理不同类型的元素
  for (const element of elements) {
    if (element?.type === 'text') {
      let str = element.attrs.content;
      // 找一个不会出现在原字符串中的占位符
      let placeholder = '__TEMP__';
      while (str.includes(placeholder)) {
        placeholder += '_X';
      }
      str = str.replace(/我/g, placeholder)
        .replace(/你/g, '我')
        .replace(new RegExp(placeholder, 'g'), '你');

      parts.push(...str.split(/(?:\s+)+/).filter(Boolean));
    }else{
      parts.push(element);
    }
  }
  console.log(parts)

  // 移除第一个元素(通常是命令本身)
  parts.shift();

  // 参数检查
  if (!parts) return session.text('.noParam');
  const last = session.elements[session.elements.length - 1];
  // 移除开头的命令
  // 处理概率计算
  if (last?.type === 'text' && last?.attrs?.content?.endsWith('概率') && last?.attrs?.content?.length > 3) {
    return session.text('.possibility', {
      param: parts,
      possibility: Math.floor(Math.random() * 10000 + 1) / 100
    });
  }

  // 处理骰子掷点
  const items = parts.join(' ').split('r').filter(Boolean);
  if (items.length === 2) {
    const [num, noodles] = items.map(Number);
    return getPoints(session, num, noodles);
  }

  const newParts = []
  // 处理多选一
  parts.forEach((element) => {
    if (typeof element === 'string') {
      newParts.push(...element.split(/(?:、|还是|，|,)+/).filter(Boolean));
    }else {
      newParts.push(element);
    }
  })
  if (newParts.length > 1) {
    return session.text('.choose', {
      option: Random.pick(newParts)
    });
  }
  return session.text('.noParam');
}

function getPoints(session: Session, num: number, noodles: number) {
  if (!Number.isInteger(num) || !Number.isInteger(noodles) || num < 0 || noodles > 0) return session.text('.invalid');
  if (num > 20 || noodles > 100000000) return session.text('.too-many');
  const points = Array(num).fill(0).map(() => Math.floor(Math.random() * noodles + 1));
  return session.text('.noodles', {
    num,
    noodles,
    points: points.join(', ')
  });
}

/**
 * qq撤回功能（其他平台不知道w
 * @param cfg config
 * @param session session
 */
export async function undo(cfg: Config, session: Session) {
    if (session?.quote?.id && session.quote.user.id === session.selfId && Date.now() - session.quote.timestamp < 2*60*1000-5*1000){
      //console.log(Date.now() - session.quote.timestamp)
      await session.bot.deleteMessage(session.channelId || session.guildId, session.quote.id);
  }
}

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

export async function test(url: string) {

}

export function writeMap(map: Map<any,any>, dest: string){
  const dir = path.dirname(dest);
  // 自动创建目录（如果不存在）
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(dest, JSON.stringify([...map], null, 2), 'utf-8');
}

export function readMap(url: string): Map<any,any> {

  // 自动创建目录（如果不存在）
  if (!fs.existsSync(url)) {
    const map = new Map<any,any>()
    writeMap(map, url);
  }
  const raw = fs.readFileSync(url, 'utf-8');
  const mapArray = JSON.parse(raw);
  return new Map(mapArray);
}

export function ready(session: Session, cfg:Config, param: string, readyMap: Map<string, string[]>) {
  const nowReadyMap = cfg.saveReadyAsFile ? readMap(cfg.saveReadyAsFile) : readyMap;
  let strArr: string[] = nowReadyMap.get(session.gid) ?? [];
  let returnMessage = session.text('.invalid')
  if (param === '+' || param === '+1'){
    strArr.push(session.username)
    returnMessage = session.text('.addReady', {
      num: strArr.length,
      list: strArr.join('\n'),
    })
  }else if(param === '-' || param === '-1'){
    const newStrArr = strArr.filter(item => item !== session.username)
    returnMessage = newStrArr.length !== strArr.length ? session.text('.delReady', {
      num: newStrArr.length,
      list: newStrArr.join('\n'),
    }) : session.text('.delFailed',{
      num: newStrArr.length,
      list: newStrArr.join('\n'),
    })
    strArr = newStrArr;
  }else if(param === '0'){
    strArr.length = 0;
    returnMessage = session.text('.clearReady');
  }else if(param === '' || !param){
    returnMessage = session.text('.listReady', {
      num: strArr.length,
      list: strArr.join('\n')
    });
  }
  nowReadyMap.set(session.gid, strArr);
  writeMap(nowReadyMap,cfg.saveReadyAsFile)
  return returnMessage;
}

async function updateMvpAPIKey(): Promise<string | null> {
  try {
    // 1. 获取 MSN 货币转换器页面 HTML
    const htmlResp = await fetch("https://www.msn.com/zh-cn/money/tools/currencyconverter");
    if (!htmlResp.ok) throw new Error(`Failed to fetch page: ${htmlResp.status}`);
    const html = await htmlResp.text();

    // 2. 使用 cheerio 解析 HTML
    const $ = cheerio.load(html);
    const head = $("head");
    const clientSettingsRaw = head.attr("data-client-settings");
    if (!clientSettingsRaw) throw new Error("未找到 data-client-settings 属性");

    // 3. 解析 JSON 获取版本号
    const clientSettings = JSON.parse(clientSettingsRaw.replace(/&quot;/g, '"'));
    const version = clientSettings?.bundleInfo?.v;
    if (!version) throw new Error("未找到 bundleInfo.v");

    // 4. 构造 targetScope 并 encodeURIComponent
    const targetScope = encodeURIComponent(JSON.stringify({
      audienceMode: "adult",
      browser: { browserType: "edgeChromium", version: "142", ismobile: "false" },
      deviceFormFactor: "desktop",
      domain: "www.msn.com",
      locale: { content: { language: "zh", market: "cn" }, display: { language: "zh", market: "cn" } },
      os: "windows",
      modes: { audienceMode: "adult" },
      platform: "web",
      pageType: "finance::financetools::financecurrencyconverter",
      pageExperiments: ["prg-cmc-river"]
    }));

    const apiUrl = `https://assets.msn.com/resolver/api/resolve/v3/config/?expType=AppConfig&apptype=finance&v=${version}&targetScope=${targetScope}`;

    // 5. 请求 API JSON
    const apiResp = await fetch(apiUrl);
    if (!apiResp.ok) throw new Error(`Failed to fetch config API: ${apiResp.status}`);
    const json = await apiResp.json();

    // 6. 取出 mvpAPIkey
    const newMvpAPIKey = json?.configs?.["shared/msn-ns/CommonAutoSuggest/default"]?.properties?.["mvpAPIkey"] ?? null;
    mvpAPIKey = newMvpAPIKey;
    return newMvpAPIKey;
  } catch (err) {
    console.error(err);
    return null;
  }
}

let mvpAPIKey: string;

async function getMvpAPIKey(): Promise<string | null> {
  return mvpAPIKey ? mvpAPIKey : updateMvpAPIKey();
}

async function getExchangeGuids(symbols: string, apikey: string): Promise<string[]> {
  try {
    const url = `https://assets.msn.cn/service/Finance/IdMap?apikey=${apikey}&MStarIds=${encodeURIComponent(symbols)}`;
    // console.log(url)
    const resp = await fetch(url);
    // console.log(resp.ok)
    if (!resp.ok) throw new Error(`请求失败: ${resp.status}`);
    let data: Array<{ mStarId: string, guid: string, type: string, exchangeId: string, symbol: string, status:number }> = await resp.json();
    data = data.filter(d => d.status === 200)
    // 返回 guid 数组，保持输入顺序
    const inputSymbols = symbols.split(",");
    const guidMap = new Map(data.map(item => [item.mStarId, item.guid]));
    return inputSymbols.map(sym => guidMap.get(sym) || "");
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
async function getQuotes(ids: string, apiKey: string): Promise<{ price: number; symbolName: string, fromCurrency: string, currency: string }[]> {
  try {
    const url = `https://assets.msn.com/service/Finance/Quotes?apikey=${encodeURIComponent(apiKey)}&cm=zh-cn&it=edgeid&ids=${encodeURIComponent(ids)}&wrapodata=false`;
    // console.log(url)
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`请求失败: ${resp.status}`);
    const data: any = await resp.json();

    // 数据可能是单个数组或二维数组，统一处理
    let quotes: any[] = [];
    if (Array.isArray(data)) {
      if (Array.isArray(data[0])) {
        quotes = data.flat();
      } else {
        quotes = data;
      }
    }

    // 返回结构包含 price 和 symbolName（中文名）
    const inputIds = ids.split(",");
    const quoteMap = new Map(
      quotes.map(q => [
        q.instrumentId,
        {
          price: q.price,
          symbolName: q.localizedAttributes?.["zh-cn"]?.symbolName || q.localizedAttributes?.["zh-cn"]?.displayName || q.symbol,
          fromCurrency: q.fromCurrency || q.displayName,
          currency: q.currency,
        },
      ])
    );

    return inputIds.map(id => quoteMap.get(id) ?? { price: 0, symbolName: "", fromCurrency: "", currency: ""});
  } catch (err) {
    console.error(err);
    return [];
  }
}

interface PriceSeries {
  prices: number[];
  timeStamps: string[];
}

async function getMonthMSNClosePrices(ids: string, apiKey: string): Promise<PriceSeries[]> {
  const url = `https://assets.msn.com/service/Finance/QuoteSummary?apikey=${apiKey}&ids=${ids}&intents=Charts,Exchanges&type=1M1H&wrapodata=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

  let data = await res.json();

  // 如果是二层数组，展平一层
  if (Array.isArray(data) && data.length && Array.isArray(data[0])) {
    data = data.flat();
  }

  if (!Array.isArray(data)) {
    throw new Error('Unexpected API response format');
  }

  // 提取 prices 和 timeStamps
  return data.map((item: any) => {
    const series = item.chart?.series;
    return {
      prices: series?.prices || [],
      timeStamps: series?.timeStamps || [],
    };
  });
}

/**
 * 绘制近一个月收盘价走势图
 * @param prices 收盘价数组
 * @param timeStamps ISO 时间戳数组
 * @param title 图表标题
 * @param width 图表宽度
 * @param height 图表高度
 * @returns buffer
 */
export async function drawOneMonthChartSkia(
  prices: number[],
  timeStamps: string[],
  title='兑换汇率',
  width = 1200,
  height = 600
): Promise<Buffer> {
  if (!prices.length || !timeStamps.length || prices.length !== timeStamps.length) return;

  // 转成 {time, price} 对象
  const dataPoints = timeStamps.map((t, i) => ({ x: new Date(t), y: prices[i] }));

  // 创建 skia-canvas
  const canvas = new Canvas(width, height);

  const whiteBackground = {
    id: 'whiteBackground',
    beforeDraw(chart: any) {
      const { ctx, width, height } = chart;
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
  };

  new Chart(canvas as unknown as ChartItem, {
    type: 'line',
    data: {
      datasets: [{
        label: title,
        data: dataPoints,
        showLine: true,        // ⭐ 不连线，只画点
        pointRadius: 0,          // 小点
        pointBorderWidth: 0,     // ⭐ 去掉外边框 → 变成实心点
        borderWidth: 2,
        borderColor: 'red',
        backgroundColor: 'rgba(0,0,255,0.1)',
        tension: 0,
        segment: {
          borderDash: ctx => {
            const p0 = ctx.p0.parsed.x as number;
            const p1 = ctx.p1.parsed.x as number;
            const diffHours = (p1 - p0) / (1000 * 60 * 60);
            return diffHours > 2 ? [6, 4] : []; // 超过2h用虚线，否则实线
          }
        }
      }]
    },
    options: {
      responsive: false,
      scales: {
        x: {
          type: 'time',
          time: {
            parser: 'YYYY-MM-DD HH:mm:ss',
            tooltipFormat: 'YYYY/MM/DD HH:mm',
            displayFormats: {
              hour: 'HH:mm',
              day: 'MM-DD',
            },
            unit: 'day',
          },
          title: { display: true, text: '日期' },
        },
        y: {
          title: { display: true, text: '价格' }
        }
      },
      layout: {
        padding: { top: 20, bottom: 20, left: 20, right: 40 }
      }
    },
    plugins: [whiteBackground]
  });

  return await canvas.toBuffer('png');
}

interface CurrencyCode {
  "country": string,
  "currencyCn": string,
  "code": string
}
let currencyCodes: CurrencyCode[] = []
export async function getCurrencyCodes(): Promise<CurrencyCode[]> {
  if (currencyCodes?.length) return currencyCodes;
  currencyCodes = require(path.resolve(assetsDir, './currency.json')) as CurrencyCode[]
  return currencyCodes;
}
let currencyCodesMap: Record<string, string> = {};
export async function getCurrencyCodesMap(): Promise<Record<string, string>> {
  if (Object.keys(currencyCodesMap)?.length) return currencyCodesMap;
  currencyCodesMap = await buildCurrencyIndex();
  return currencyCodesMap;
}
async function buildCurrencyIndex(): Promise<Record<string, string>> {
  const map: Record<string, string> = {};

  (await getCurrencyCodes()).forEach(c => {
    map[c.country] = c.code
    map[c.currencyCn] = c.code
  })
  map["日元"] = "JPY"
  map["人民币"] = "CNY"
  map["港币"] = "HKD"
  return map
}



