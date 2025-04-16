import {Context, h, Schema, Session, Universal} from 'koishi'
import { Jimp } from 'jimp';
//import { Sharp } from 'sharp'
import * as fs from 'fs'

export const name = 'starfx-bot'
export let baseDir: string;
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
  //init
  if (fs.existsSync(`${__dirname}/../assets/lock.png`)) {
    fs.mkdirSync(`${ctx.baseDir}/data/starfx-bot/assets/`,{recursive: true})
    fs.copyFileSync(`${__dirname}/../assets/lock.png`, `${ctx.baseDir}/data/starfx-bot/assets/lock.png`)
    fs.rmSync(`${__dirname}/../assets/lock.png`)
  }
  if (fs.existsSync(`${__dirname}/../assets/sold.png`)) {
    fs.mkdirSync(`${ctx.baseDir}/data/starfx-bot/assets/`,{recursive: true})
    fs.copyFileSync(`${__dirname}/../assets/sold.png`, `${ctx.baseDir}/data/starfx-bot/assets/sold.png`)
    fs.rmSync(`${__dirname}/../assets/sold.png`)
  }
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
      return await drawSold(await getImageSrc(session, param));
    })
  }
}

export async function getImageSrc(session: Session, param: string){
  let userid = '';
  let imageSrc = '';
  console.log(param);
  if (!param){
    console.log('no')
    userid = session.userId;
  }else if(param.startsWith('<at id=')){
    console.log('at')
    userid = param.match(/<at\s+id="(\d+)"\s*\/?>/i)?.[1] ?? null;
  }else if(param.startsWith('<img src=')){
    console.log('img')
    return param.match(/<img[^>]*\s+src="([^"]+)"/i)?.[1] ?? null;
  }else{
    console.log('other')
    const index = param.indexOf('<');
    param = param.slice(index);
    //console.log('2' + param);
    if (param?.length){
      return getImageSrc(session, param);
    }else{
      return '';
    }
  }
  if(userid){
    imageSrc = `https://q1.qlogo.cn/g?b=qq&nk=${userid}&s=640`;
  }

  return imageSrc;
}

export async function drawLock(baseImage: string) {
  if (!baseImage) {
    return '输入无效。';
  }
  const lockUrl = `${baseDir}/data/starfx-bot/assets/lock.png`
  const image = await Jimp.read(baseImage);
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
  const soldUrl = `${baseDir}/data/starfx-bot/assets/sold.png`;
  const image = await Jimp.read(baseImage);
  const size1 = image.width > image.height ? image.height : image.width;
  image.cover({w:size1,h:size1})
  const middle = new Jimp({width: image.width, height: image.height, color: 0xffffffff});
  const overlay = await Jimp.read(soldUrl);
  //image.resize({w:300,h:300});
  overlay.resize({w:image.width * 182 / 240});
  middle.opacity(0.4);
  image.composite(middle);
  image.composite(overlay, image.width * 29 / 240, image.width * 29 / 240);
  return h.image(await image.getBuffer('image/jpeg'),"image/jpeg");
}
