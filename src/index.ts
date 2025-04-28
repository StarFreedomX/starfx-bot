import {Context, h, Random, Schema, Session} from 'koishi'
//import {Jimp} from 'jimp';
import sharp from 'sharp'
import * as fs from 'fs'
import {Jimp} from "jimp";

export const name = 'starfx-bot'
export let baseDir: string;
export let assetsDir: string;

export interface Config {
  openLock: boolean,
  openSold: boolean,
  bangdreamBorder: boolean,
  atNotSay: boolean,
  atNotSayOther: boolean,
  atNotSayProperty: number,
  atNotSayOtherProperty: number,
  replyBot: string,
  iLoveYou: boolean,
}

export const Config = Schema.intersect([
  Schema.object({
    openLock: Schema.boolean().default(true).description('开启明日方舟封印功能'),
    openSold: Schema.boolean().default(true).description('开启闲鱼"卖掉了"功能'),
    bangdreamBorder: Schema.boolean().default(true).description('开启BanG Dream!边框功能'),
    atNotSay: Schema.boolean().default(true).description('开启‘艾特我又不说话’功能'),
    atNotSayProperty: Schema.number().role('slider')
      .min(0).max(1).step(0.01).default(0.5).description("'艾特我又不说话'回复概率"),
    atNotSayOther: Schema.boolean().default(true).description('开启‘艾特他又不说话’功能'),
    atNotSayOtherProperty: Schema.number().role('slider')
      .min(0).max(1).step(0.01).default(0.5).description("'艾特他又不说话'回复概率"),
    iLoveYou: Schema.boolean().default(true).description('开启‘我喜欢你’功能'),
    replyBot: Schema.union(['关闭', '无需at', '必须at']).default('无需at').description('回复‘我才不是机器人！’功能'),
  }),
])

export const usage =
  `<h5>StarFreedomX的自用插件 放了一些小功能</h5>
  `

export function apply(ctx: Context, cfg: Config) {

  ctx.i18n.define('zh-CN', require('./locales/zh-CN'));

  baseDir = ctx.baseDir;
  assetsDir = `${ctx.baseDir}/data/starfx-bot/assets`;
  //init
  initAssets();
  // write your plugin here

  if (cfg.openLock) {
    ctx.command('封印 [param]')
      .action(async ({session}, param) => {
        return await drawLock(ctx, await getImageSrc(session, param));
      })
  }
  if (cfg.openSold) {
    ctx.command('卖掉了 [param]')
      .action(async ({session}, param) => {
        return await drawSold(ctx, await getImageSrc(session, param));
      })
  }

  if (cfg.bangdreamBorder) {
    ctx.command('bangdreamborder [param]')
      .alias('bdbd')
      .option('starNum', '-n <starNum: number>')
      .option('color', '-c <color: string>')
      .option('train', '-t <train: string>')
      .option('band', '-b <band: string>')
      .action(async ({session, options}, param) => {
        session.send('图片处理中请稍等...')
        console.log(param)
        const drawConfig = await handleBanGDreamConfig(ctx, options);
        const imageBase64: string = await drawBanGDream(await getImageSrc(session, param), drawConfig);
        return h.image(imageBase64)
      })
  }

  ctx.middleware(async (session, next) => {
    const elements = session.elements;
    //console.log(elements);

    await atNotSayReply(cfg, session, elements);

    await replyBot(cfg, session, elements);

    await iLoveYou(cfg, session, elements);


    return next();
  });


  function initAssets() {
    const fromUrl = `${__dirname}/../assets`;
    assetsDir = `${ctx.baseDir}/data/starfx-bot/assets`;
    if (!fs.existsSync(fromUrl)) return;
    if (!fs.readdirSync(fromUrl)?.length) return;
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, {recursive: true});
    }

    fs.cpSync(fromUrl, assetsDir, {recursive: true, force: true});
    if (process.env.NODE_ENV !== "development") {
      fs.rmSync(fromUrl, {recursive: true});
    }

  }
}

export async function getImageSrc(session: Session, param: string): Promise<string> {

  //判断参数是不是纯数字或者没有参数
  if (param?.length && param?.length === String(Number(param))?.length) {
    return `https://q1.qlogo.cn/g?b=qq&nk=${param}&s=640`;
  } else if (!param?.length) {
    return `https://q1.qlogo.cn/g?b=qq&nk=${session.userId}&s=640`;
  }
  //发送的消息中选择
  const elementArray = session.elements;
  for (const element of elementArray) {
    if (element?.type === 'img') {
      return element?.attrs?.src;
    } else if (element?.type === 'at' && element?.attrs?.id) {
      return `https://q1.qlogo.cn/g?b=qq&nk=${element.attrs.id}&s=640`;
    }
  }
  //引用的消息中选择
  const quoteElementArray = session?.quote?.elements;
  if (quoteElementArray?.length) {
    for (const element of quoteElementArray) {
      if (element?.type === 'img') {
        return element?.attrs?.src;
      } else if (element?.type === 'at' && element?.attrs?.id && element.attrs.id !== session.selfId) {
        return `https://q1.qlogo.cn/g?b=qq&nk=${element?.attrs?.id}&s=640`;
      }
    }
  }
  //没有那么返回空值
  return '';

}

/*function initAssets(fileName: string) {
  if (fs.existsSync(`${__dirname}/../assets/${fileName}`)) {
    fs.mkdirSync(`${assetsDir}/`, {recursive: true});
    fs.copyFileSync(`${__dirname}/../assets/${fileName}`, `${assetsDir}/${fileName}`);
    //开发环境不删除assets，方便包的发布(这样就不会忘记assets了
    if (process.env.NODE_ENV !== "development") {
      fs.rmSync(`${__dirname}/../assets/${fileName}`);
    }
  }
}*/

export async function handleBanGDreamConfig(ctx: Context, options) {
  const types = {
    cool: ['cool', 'blue', '蓝', '蓝色'],
    powerful: ['powerful', 'red', '红', '红色'],
    peer: ['peer', 'green', '绿', '绿色'],
    happy: ['happy', 'orange', '橙', '橙色'],
  }
  const bands = {
    ppp: ['ppp', 'Poppin\'Party', '破琵琶', '步品破茶', 'poppin', 'popipa', 'poppinparty', 'ポピパ'],
    ag: ['ag', 'Afterglow', '夕阳红', '悪蓋愚狼'],
    pp: ['pp', 'Pastel＊Palettes', 'Pastel*Palettes', 'PastelPalettes', '怕死怕累', 'pastel', 'palettes', 'pasupare', 'パスパレ', '破巣照破烈斗'],
    hhw: ['hhw', 'ハロー、ハッピーワールド！', 'Hello,HappyWorld!', 'helloHappyWorld', 'ハロハピ', 'Hello，HappyWorld！', 'harohapi', '破狼法被威悪怒', '儿歌团', '好好玩'],
    r: ['r', 'Roselia', '露世里恶', '萝', '露世裏悪', 'ロゼリア', 'r组', '相声团', '相声组'],
    ras: ['ras', 'RaiseASuilen', 'raise', 'suilen', 'ラス', '零図悪酔恋', '睡莲', '麗厨唖睡蓮', '睡蓮'],
    mnk: ['mnk', 'モニカ', '蝶团', '蝶', 'Morfonica', '毛二力', 'monika', 'monica'],
    go: ['go', 'MyGO!!!!!', 'MyGO！！！！！', 'mygo', '我去！！！！！', '我去!!!!!', '我去', '卖狗']
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
  if (options.color) {
    for (const [type, aliases] of Object.entries(types)) {
      if (aliases.includes(options.color.toLowerCase())) {
        drawConfig.color = type;
        break;
      }
    }
  }
  //处理band参数
  if (options.band) {
    for (const [band, aliases] of Object.entries(bands)) {
      if (aliases.includes(options.band.toLowerCase())) {
        drawConfig.band = band;
        break;
      }
    }
  }
  // 处理 starNum 参数
  const starNum = options.starNum ? parseInt(options.starNum) : 0;
  drawConfig.starNum =  starNum > 0 && starNum < 10 ? starNum : 0;

  // 处理 starType 参数
  if (drawConfig.starType){
      for (const [train, aliases] of Object.entries(trains)) {
        if (aliases.includes(options.color.toLowerCase())) {
          drawConfig.starType = train;
          break;
        }
      }
  }
  return drawConfig;
}

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


async function getImageFromUrl(ctx: Context, url: string) {
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

async function atNotSayReply(cfg: Config, session: Session, elements: h[]) {
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

async function replyBot(cfg: Config, session: Session, elements: h[]) {
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

async function iLoveYou(cfg: Config, session: Session, elements: h[]) {
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

async function drawBanGDream(avatar: string, inputOptions?: {
  color: string,
  band: string,
  starType: string,
  starNum: number,
  border: string,
}) {
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
