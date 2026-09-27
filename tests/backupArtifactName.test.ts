// 第三十七轮：备份产物名 ⇄ 工作流上传面 ⇄ 存活判据认的名字，三者必须同值（一 fact 一 judge 的反面就是这里）。
// 立它的实测：R36 证明"有 fail-closed 守卫 ≠ 守卫会在链路上被执行"；R37 加了第二条上传路径后，
// 一旦产物名改了而判据的正则没改，备份链会**绿着不被认**（判据永远看不到备份产物）。
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BACKUP_ARTIFACT_NAME, BACKUP_UPLOAD_RULE, PLAIN_UPLOAD_GUARD } from '../scripts/check-backup-liveness.mjs'
import { STEP_HEAD, uploadStepBlocks } from './helpers/workflowSteps.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const WF = join(REPO, '.github', 'workflows')
const wfText = (f) => readFileSync(join(WF, f), 'utf8').replace(/\r\n/g, '\n')
/** 把 `name: d1-backup-${{ github.run_number }}` 这类模板按真实 run_number 展开（形状自证用，不靠肉眼）。 */
const renderName = (raw, runNumber) => raw.replace(/\$\{\{\s*github\.run_number\s*\}\}/g, String(runNumber)).trim()

describe('备份产物名三向对账', () => {
  it('形状自证：正则真在匹配渲染后的名字（非备份名必须不匹配，防"正则写得宽"把空气判成绿）', () => {
    expect(STEP_HEAD.test('      - name: Upload backup artifact (encrypted · non-private repo)')).toBe(true)
    expect(STEP_HEAD.test('      steps:')).toBe(false)
    expect(renderName('d1-backup-${{ github.run_number }}', 7)).toBe('d1-backup-7')
    expect(BACKUP_ARTIFACT_NAME.test(renderName('d1-backup-${{ github.run_number }}', 7))).toBe(true)
    expect(BACKUP_ARTIFACT_NAME.test(renderName('d1-backup-enc-${{ github.run_number }}', 7))).toBe(true)
    for (const bad of ['d1-backup', 'd1-backup-latest', 'coverage-report', 'd1-backup-7.zip', 'x-d1-backup-7']) {
      expect(BACKUP_ARTIFACT_NAME.test(bad), `${bad} 不该被当成备份产物`).toBe(false)
    }
  })
  it('正向：备份工作流里每一条上传产物的 name 都被判据认（新增上传步骤而不改名 = 当场红）', () => {
    const text = wfText('d1-backup.yml')
    const declared = [...text.matchAll(/^[ \t]+name:[ \t]*(d1-backup.*)$/gm)].map((m) => renderName(m[1], 1234))
    expect(declared.length, '取数面：至少两条上传路径（明文 + 密文）').toBeGreaterThanOrEqual(2)
    for (const n of declared) expect(n).toMatch(BACKUP_ARTIFACT_NAME)
    // 反向：每条上传步骤都得在自己的块里写出 `name:`，否则判据认不到它产出的产物
    const uploads = uploadStepBlocks(text)
    expect(uploads.length).toBeGreaterThanOrEqual(2)
    for (const u of uploads) expect(BACKUP_UPLOAD_RULE.test(u), `上传步骤没写 d1-backup*-\${{ github.run_number }}：${u.split('\n')[0]}`).toBe(true)
  })
  it('明文上传步骤必须被互斥 if 锁住（非私有仓只允许密文产物）', () => {
    const uploads = uploadStepBlocks(wfText('d1-backup.yml'))
    const plain = uploads.filter((u) => /path:\s*d1-backup\.sql\s*$/m.test(u))
    const enc = uploads.filter((u) => /\.smbk/.test(u))
    expect(plain.length, '明文上传步骤取数面为空 ⇒ 判据没在判任何步骤').toBeGreaterThan(0)
    expect(enc.length).toBeGreaterThan(0)
    for (const u of plain) expect(PLAIN_UPLOAD_GUARD.test(u), '明文上传缺 mode==plaintext 条件').toBe(true)
    for (const u of enc) expect(/if:[^\n]*mode == 'encrypted'/.test(u)).toBe(true)
  })
  it('全仓扫一遍：没有任何工作流把非备份名当备份产物上传（d1-backup.yml 之外也不许出现第二个备份面）', () => {
    const files = readdirSync(WF).filter((f) => f.endsWith('.yml'))
    const offenders = []
    for (const f of files) {
      for (const blk of uploadStepBlocks(wfText(f))) {
        const nm = /name:\s*(\S+)/.exec(blk)?.[1] || ''
        if (/backup/i.test(nm) && !BACKUP_ARTIFACT_NAME.test(renderName(nm, 1))) offenders.push(`${f}: ${nm}`)
      }
    }
    expect(offenders, `备份面产物名漂移（判据认不到）：${offenders.join(' | ')}`).toEqual([])
  })
})
