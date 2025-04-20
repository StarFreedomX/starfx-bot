import {Context, h, Random, Schema, Session} from 'koishi'
//import {Jimp} from 'jimp';
import sharp from 'sharp'
import * as fs from 'fs'

export const name = 'starfx-bot'
export let baseDir: string;
export let assetsDir: string;

export interface Config {
  openLock: boolean,
  openSold: boolean,
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
  initAssets('lock.png');
  initAssets('sold.png');
  // write your plugin here

  if (cfg.openLock) {
    ctx.command('封印 [param]')
      .action(async ({session}, param) => {
        console.log('elements');
        console.log(session.elements);
        console.log('quote');
        console.log(session.quote);
        console.log('param');
        console.log(param);
        return await drawLock(ctx, await getImageSrc(session, param));
      })
  }
  if (cfg.openSold) {
    ctx.command('卖掉了 [param]')
      .action(async ({session}, param) => {
        console.log('elements');
        console.log(session.elements);
        console.log('quote');
        console.log(session.quote);
        console.log('param');
        console.log(param);
        //console.log(session.selfId);
        return await drawSold(ctx, await getImageSrc(session, param));
      })
  }

  ctx.middleware(async (session, next) => {
    const elements = session.elements;
    console.log(elements);
    if (cfg.atNotSay || cfg.atNotSayOther) {
      if (elements.length === 1 && elements[0].type === 'at') {
        if (elements[0].attrs.id === session.selfId) {
          if (cfg.atNotSay) {
            if (Random.bool(cfg.atNotSayProperty)) {
              await session.send(session.text('middleware.messages.atNotReply'));
            }
          }
        } else {
          if (cfg.atNotSayOther) {
            if (Random.bool(cfg.atNotSayOtherProperty)) {
              await session.send(session.text('middleware.messages.atNotReplyOther'));
            }
          }
        }
      }
    }
    if (cfg.replyBot !== '关闭') {
      //console.log('test')
      const bots = ['bot', '机器人', 'Bot', 'BOT', '机器人！', '机器人!', '人机'];
      const texts = elements?.filter(e => e.type === 'text').map(e => e?.attrs?.content?.trim());
      const ats = elements?.filter(e => e.type === 'at').map(e => e?.attrs?.id);

      const mentionedBot = texts?.some(t => bots.includes(t));
      const atMe = ats?.includes(session.selfId);
      if (
        (elements?.length === 1 && mentionedBot && cfg.replyBot === '无需at') ||
        (elements?.length === 2 && mentionedBot && atMe)
      ) {
        await session.send(session.text('middleware.messages.notBot'));
      }

    }
    if (cfg.iLoveYou) {
      if (
        elements?.length === 2 &&
        elements.some(e => e.type === 'at' && e?.attrs?.id === session.selfId) &&
        elements.some(e => e.type === 'text' && e?.attrs?.content?.trim() === session.text('middleware.messages.loveMessage'))
      ) {
        await session.send(session.text('middleware.messages.iLoveU', {
          at: h.at(session.userId),
          quote: h.quote(session.messageId)
        }))
      }
    }

    return next();
  })
}

export async function getImageSrc(session: Session, param: string) {

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

function initAssets(fileName: string) {
  if (fs.existsSync(`${__dirname}/../assets/${fileName}`)) {
    fs.mkdirSync(`${assetsDir}/`, {recursive: true})
    fs.copyFileSync(`${__dirname}/../assets/${fileName}`, `${assetsDir}/${fileName}`)
    fs.rmSync(`${__dirname}/../assets/${fileName}`)
  }
}

export async function drawLock(ctx: Context, baseImage: string) {
  const image = await getImageFromUrl(ctx, baseImage);
  if (image === -1){
    return '发生错误'
  }else if (image === -2){
    return '输入无效'
  }
  const imageMetadata = await image.metadata();
  const lockUrl = `${baseDir}/data/starfx-bot/assets/lock.png`;
  const size1 = Math.min(imageMetadata.width, imageMetadata.height);
  image.resize({width: size1, height: size1, fit: 'cover'})
  const overlay = sharp(lockUrl).png();
  overlay.resize({width: imageMetadata.width});
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
  if (image === -1){
    return '发生错误'
  }else if (image === -2){
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
  const overlaySize = Math.round(imageMetadata.width * 182 / 240)
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


async function getImageFromUrl(ctx:Context, url: string) {
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
