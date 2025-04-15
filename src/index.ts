import {Context, h, Schema, Session, Universal} from 'koishi'
import { Jimp } from 'jimp';
import * as fs from 'fs'


export const name = 'starfx-bot'
export let baseDir: string;
export interface Config {
  openLock: boolean,
}

export const Config: Schema<Config> = Schema.object({
  openLock: Schema.boolean().default(true).description('开启明日方舟封印功能'),
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
  // write your plugin here
  async function getMemberList(session: Session, gid: string) {
    let result: Universal.GuildMember[] = []
    try {
      const { data, next } = await session.bot.getGuildMemberList(session.guildId)
      result = data
      if (next) {
        const { data } = await session.bot.getGuildMemberList(session.guildId, next)
        result.push(...data)
      }
    } catch {
    }
    return result
  }

  if (cfg.openLock) {
    ctx.command('封印 [param]')
      .action(async ({session}, param) => {
        const { gid } = session
        let userid = '';
        let imageSrc = '';
        if (!param){
          console.log('no')
          userid = session.userId;
        }else if(param.startsWith('<at id=')){
          console.log('at')
          userid = param.match(/<at\s+id="(\d+)"\s*\/?>/i)?.[1] ?? null;
        }else if(param.startsWith('<img src=')){
          console.log('img')
          imageSrc = param.match(/<img[^>]*\s+src="([^"]+)"/i)?.[1] ?? null;
        }else{
          console.log('other')
        }
        if (userid){
          const memberList = await getMemberList(session, gid)
          const selected = memberList.find(u => u.user.id == userid)
          const [name, avatar] = getMemberInfo(selected, selected.user.id)
          imageSrc = avatar;
        }

        //console.log(typeof (await Jimp.read(imageSrc)))
        return await drawLock(imageSrc);
      })
  }
}

export async function drawLock(baseImage: string) {
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

export function getMemberInfo(member: Universal.GuildMember, id: string) {
  const name = member?.nick || member?.user?.nick || member?.user?.name || id
  const avatar = member?.avatar || member?.user?.avatar
  return [name, avatar]
}
