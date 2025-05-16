import {Context, h, Random, Session} from "koishi";
import fs from "fs";
import path from "node:path";
import sharp from "sharp";
import {Jimp} from "jimp";
import {assetsDir, baseDir, Config, starfxLogger} from "./index";

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
  const tagConfigPath = path.join(assetsDir, "tagConfig", `${gid}.json`);
  const recordDir = path.join(assetsDir, "record", gid);

  if (!fs.existsSync(recordDir)) return null;

  const files = fs.readdirSync(recordDir).filter(file => /\.(png|jpe?g|webp|gif)$/i.test(file));
  if (!files.length) return null;

  let weightedFiles: string[] = [];

  // 如果 tag 存在且 config 存在
  if (tag && fs.existsSync(tagConfigPath)) {
    const tagConfigJson: tagConfig = JSON.parse(fs.readFileSync(tagConfigPath, "utf8") || "{}");

    files.forEach(file => {
      const name = path.parse(file).name;
      const tags = tagConfigJson[name] || [];

      if (tags.includes(tag)) {
        // 权重更高：加入 5 次
        for (let i = 0; i < cfg.tagWeight; i++) {
          weightedFiles.push(file);
          //console.log(`${file.toString()} - match ${tag} add+++++`)
        }

      } else {
        // 普通权重：加入 1 次
        weightedFiles.push(file);
        //console.log(`${file.toString()} - don't match ${tag} add+`)
      }
    });
  } else {
    // 没 tag 的情况：均匀分布
    weightedFiles = files;
  }

  const selected = Random.pick(weightedFiles);
  return selected ? path.join(recordDir, selected) : null;
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
  if (number && param?.length && param?.length === String(Number(param))?.length) {
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
  // 处理仅包含at的情况
  if ((cfg.atNotSay || cfg.atNotSayOther) &&
    elements.length === 1 &&
    elements[0].type === 'at') {

    const isAtSelf = elements[0].attrs.id === session.selfId;

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


  const [image, colorImage, bandImage, starImage, borderImage] = await Promise.all([
    Jimp.read(avatar),
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

/*export function saveArchive(quoteElements: h[], gid: string, session: Session) {

}*/
