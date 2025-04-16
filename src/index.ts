import {Context, h, Schema, Session} from 'koishi'
import {Jimp} from 'jimp';
//import { Sharp } from 'sharp'
import * as fs from 'fs'

export const name = 'starfx-bot'
export let baseDir: string;
export let assetsDir: string;
export interface Config {
  openLock: boolean,
  openSold: boolean,
}

export const Config: Schema<Config> = Schema.object({
  openLock: Schema.boolean().default(true).description('开启明日方舟封印功能'),
  openSold: Schema.boolean().default(true).description('开启闲鱼"卖掉了"功能'),
})

export const usage = 'StarFreedomX的自用插件 放了一些小功能'

export function apply(ctx: Context, cfg: Config) {
  baseDir = ctx.baseDir;
  assetsDir = `${ctx.baseDir}/data/starfx-bot/assets`;
  //init
  initAssets('lock.png');
  initAssets('sold.png');
  // write your plugin here

  if (cfg.openLock) {
    ctx.command('封印 [param]')
      .action(async ({session}, param) => {
        return await drawLock(await getImageSrc(session, param));
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
      return await drawSold(await getImageSrc(session, param));
    })
  }
}

export async function getImageSrc(session: Session, param: string){

  //判断参数是不是纯数字或者没有参数
  if(param?.length && param?.length === String(Number(param))?.length){
    return `https://q1.qlogo.cn/g?b=qq&nk=${param}&s=640`;
  }else if(!param?.length){
    return `https://q1.qlogo.cn/g?b=qq&nk=${session.userId}&s=640`;
  }
  //发送的消息中选择
  const elementArray = session.elements;
  for (const element of elementArray) {
    if (element?.type === 'img'){
      return element?.attrs?.src;
    }else if(element?.type === 'at' && element?.attrs?.id && element.attrs.id !== session.selfId){
      return `https://q1.qlogo.cn/g?b=qq&nk=${element.attrs.id}&s=640`;
    }
  }
  //引用的消息中选择
  const quoteElementArray = session?.quote?.elements;
  if(quoteElementArray?.length){
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
function initAssets(fileName: string){
  if (fs.existsSync(`${__dirname}/../assets/${fileName}`)) {
    fs.mkdirSync(`${assetsDir}/`,{recursive: true})
    fs.copyFileSync(`${__dirname}/../assets/${fileName}`, `${assetsDir}/${fileName}`)
    fs.rmSync(`${__dirname}/../assets/${fileName}`)
  }
}

export async function drawLock(baseImage: string) {
  if (!baseImage) {
    return '输入无效。';
  }
  const lockUrl = `${baseDir}/data/starfx-bot/assets/lock.png`
  let image;
  try {
    image = await Jimp.read(baseImage);
  }catch(err){
    console.error(err);
    return '发生错误。';
  }
  const size1 = image.width > image.height ? image.height : image.width;
  image.cover({w:size1,h:size1})
  //const middle = new Jimp({width: image.width, height: image.height, color: 0xffffffff});
  const overlay = await Jimp.read(lockUrl);
  //image.resize({w:300,h:300});
  overlay.resize({w:image.width});
  //middle.opacity(0.2);
  //image.composite(middle);
  image.composite(overlay);
  return h.image(await image.getBuffer('image/jpeg'),"image/jpeg");
}

export async function drawSold(baseImage: string) {
  if (!baseImage) {
    return '输入无效。';
  }
  const soldUrl = `${assetsDir}/sold.png`;
  let image;
  try {
    image = await Jimp.read(baseImage);
  }catch(err){
    console.error(err);
    return '发生错误。'
  }
  const size1 = Math.min(image.width,image.height);
  image.cover({w:size1,h:size1})
  const middle = new Jimp({width: image.width, height: image.height, color: 0xffffffff});
  const overlay = await Jimp.read(soldUrl);
  overlay.resize({w:image.width * 182 / 240});
  middle.opacity(0.4);
  image.composite(middle);
  image.composite(overlay, image.width * 29 / 240, image.width * 29 / 240);
  return h.image(await image.getBuffer('image/jpeg'),"image/jpeg");
}
