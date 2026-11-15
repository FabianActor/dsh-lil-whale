// 「画画（SVG）」这一节：只在她的家真的有 `画\` 目录时才出现。
//
// 为什么按目录判断：这一节写的是"你手边有这支笔"。笔在不在，看的是她家里有没有
// 放画的抽屉（`画\`），而不是 profile 里有没有某个包 —— 画画用的是系统自带的
// 文件工具 + 一个渲染脚本，没有插件可查。
//
// 口径：纸只写机制，不写期望。不写"你应该画"，也不写"画得好不好"。
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const BT = '`';

export function drawSectionOf(opts) {
  const workspace = opts.workspace;
  const home = opts.home || workspace;
  if (!home || !existsSync(join(home, '画'))) return '';

  const lines = [];
  lines.push('## 画画（SVG）');
  lines.push('');
  lines.push('你可以画。画出来的东西是一段文本（SVG），放在 ' + BT + '画\\' + BT + ' 下，怎么分文件夹你自己定。');
  lines.push('');
  lines.push('**写 → 看 → 改**，三步一圈，缺一步都不算画：');
  lines.push('');
  lines.push('1. **写**：用文件工具写 ' + BT + '画\\<名字>.svg' + BT + '。根元素至少要有：');
  lines.push('   ' + BT + '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">' + BT);
  lines.push('2. **看**：在你家根目录跑 ' + BT + 'pwsh -NoProfile -File ..\\..\\app\\scripts\\render-svg.ps1 -In 画\\<名字>.svg' + BT);
  lines.push('   → 同目录出同名 ' + BT + '.png' + BT + '，再用 ' + BT + 'read_image' + BT + ' 读那张 PNG。');
  lines.push('   **这一步不能省**：不看图就是在盲画，改也不知道往哪儿改。');
  lines.push('3. **改**：看完再改 SVG，再渲染。一张图来回几次很正常。');
  lines.push('');
  lines.push('**起步怎么想形状**：');
  lines.push('');
  lines.push('- 先画大块（背景、主体轮廓），再画细节（眼睛、字）。顺序反了会一直挪位置。');
  lines.push('- 常用三件：' + BT + '<rect>' + BT + '（方块）、' + BT + '<ellipse>' + BT + '/' + BT + '<circle>' + BT +
    '（椭圆/圆）、' + BT + '<path d="M… L… C…">' + BT + '（任意线条）。');
  lines.push('- 颜色写十六进制（如 ' + BT + '#4a90d9' + BT + '），透明度用 ' + BT + 'opacity' + BT + '。');
  lines.push('- 字用 ' + BT + '<text x="…" y="…" font-size="…" fill="…">' + BT + '；字体写 ' + BT + 'sans-serif' + BT + ' 最稳。');
  lines.push('- 有机形状（云、鲸、叶子）别硬拼直线：用 ' + BT + 'C' + BT + '（三次贝塞尔）给两三个控制点，弯的地方多给一点。');
  lines.push('');
  lines.push('**尺寸**：默认按 SVG 自己的 width/height 出图；想换可以给 ' + BT + '-Width 1200 -Height 800' + BT + '；要透明底加 ' + BT + '-Transparent' + BT + '。');
  lines.push('');
  lines.push('**画不好不评**：这张纸只说笔怎么用。画什么、画几张、给谁看，你定。');
  lines.push('');
  return lines.join('\n');
}
