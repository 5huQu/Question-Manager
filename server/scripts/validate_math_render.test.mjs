import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

function validate(payload) {
  const proc = spawnSync('node', ['server/scripts/validate_math_render.mjs'], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  })
  assert.equal(proc.status, 0, proc.stderr)
  return JSON.parse(proc.stdout)
}

const riskyButValidPayload = {
  problem_text: '(3)设 $0 < p_3 < p_2 < p_1 < 1$，为使累计答题数目的均值最小，小张应如何安排答题次序？',
  answer: '应按 $A \\rightarrow B \\rightarrow C$ 的顺序答题',
  analysis: [
    '（3）计算按 $B \\rightarrow A \\rightarrow C$ 的顺序、$B \\rightarrow C \\rightarrow A$ 的顺序、$C \\rightarrow A \\rightarrow B$ 的顺序、$C \\rightarrow B \\rightarrow A$ 的顺序答题时，累计答题数目的均值，从而作出判断·',
    '',
    '由（1）得',
    '$$E(X_1) = 1 \\times p_1 + 2(1 - p_1)p_2 + 3(1 - p_1)(1 - p_2)$$',
    '$$= 3 - 2p_1 - p_2 + p_1p_2$$.',
    '',
    '| $X$ | $1$ | $2$ | $3$ |',
    '| $P$ | $p_1$ | $(1 - p_1)p_2$ | $(1 - p_1)(1 - p_2)$ |',
  ].join('\n'),
}

const validResult = validate(riskyButValidPayload)
assert.equal(validResult.ok, true)
assert.deepEqual(validResult.errors, [])

const rawArrayResult = validate({
  problem_text: '',
  answer: '',
  analysis: String.raw`\begin{array}{c|cccc}
$X_1$ & 0 & 1 & 2 & 3 \
\hline
P & \frac{1}{27} & \frac{2}{9} & \frac{4}{9} & \frac{8}{27} \
\end{array}`,
})
assert.equal(rawArrayResult.ok, false)
assert.equal(rawArrayResult.errors[0].code, 'raw_latex_outside_math')

const brokenInlineArrayResult = validate({
  problem_text: '',
  answer: '',
  analysis: String.raw`所以，$X$ 的分布列为：
$\begin{array}{c|cccc}$
X & 0 & 1 & 2 & 3 \
$\hline$
P &$\dfrac{1}{27}$&$\dfrac{2}{9}$&$\dfrac{4}{9}$&$\dfrac{8}{27} \\$
$\end{array}$
所以 $E(X)=2$．`,
})
assert.equal(brokenInlineArrayResult.ok, false)
assert.ok(['math_delimiter_unclosed', 'raw_latex_outside_math', 'katex_parse_error'].includes(brokenInlineArrayResult.errors[0].code))

const corruptedPayload = {
  ...riskyButValidPayload,
  analysis: riskyButValidPayload.analysis.replace('$(1 - p_1)p_2$', '$(1 - p_1)$p_2$'),
}

const corruptedResult = validate(corruptedPayload)
assert.equal(corruptedResult.ok, false)
assert.ok(corruptedResult.errors.length > 0)
assert.equal(corruptedResult.errors[0].field, 'analysis')
assert.equal(corruptedResult.errors[0].code, 'math_delimiter_unclosed')
assert.ok(corruptedResult.errors[0].snippet.includes('$(1 - p_1)$p_2$'), corruptedResult.errors[0].snippet)
assert.ok(!corruptedResult.errors[0].snippet.includes('$C \\rightarrow B \\righ'), corruptedResult.errors[0].snippet)

const visuallyToleratedNestedInlinePayload = {
  problem_text: '若 $A$ 发生，求概率。',
  answer: '',
  analysis: String.raw`（1）分析可知 $X \sim B(3, \frac{2}{3})$，利用二项分布可得出随机变量 $X$ 的分布列，利用二项分布的期望公式可求得 $E(X)$ 的值；

（2）将“在第 4 轮结束时，学生代表甲答对 3 道题并刚好胜出”记为事件 $A$，“在第 4 轮结束时，学生代表乙答对 0 道题”记为事件 $A_1$，“在第 4 轮结束时，学生代表乙答对 1 道题”记为事件 $A_2$，则 $A_1$、$A_2$ 互斥，且 $A = A_1 \cup $A_2$，分别计算出 $P($A_1$)$、$P($A_2$)$ 的值，利用互斥事件的概率公式可求得 $P(A)$ 的值.

（1）由题可得 $X \sim B(3, \frac{2}{3})$，$X$ 的可能取值为 0、1、2、3，

所以 $P(X=0) = (1 - \frac{2}{3})^3 = \frac{1}{27}$ ， $P(X=1) = C_3^1 \cdot \frac{2}{3} \cdot (1 - \frac{2}{3})^2 = \frac{2}{9}$ ，

$P(X=2) = C_3^2 \cdot (\frac{2}{3})^2 \cdot (1 - \frac{2}{3}) = \frac{4}{9}$ ， $P(X=3) = C_3^3 \cdot (\frac{2}{3})^3 \cdot (1 - \frac{2}{3})^0 = \frac{8}{27}$ ，

所以，$X$ 的分布列为：

| $X$ | 0 | 1 | 2 | 3 |
| :---: | :---: | :---: | :---: | :---: |
| $P$ | $\frac{1}{27}$ | $\frac{2}{9}$ | $\frac{4}{9}$ | $\frac{8}{27}$ |

所以 $E(X) = 3 \times \frac{2}{3} = 2$.

（2）将“在第 4 轮结束时，学生代表甲答对 3 道题并刚好胜出”记为事件 $A$，

“在第 4 轮结束时，学生代表乙答对 0 道题”记为事件 $A_1$，

“在第 4 轮结束时，学生代表乙答对 1 道题”记为事件 $A_2$，则 $A_1$、$A_2$ 互斥，且 $A = A_1 \cup $A_2$，

则 $P(A_1) = C_4^3 \cdot (\frac{2}{3})^3 \cdot (1 - \frac{2}{3}) \cdot (1 - \frac{1}{2})^4 = \frac{1}{54}$ ，

$P(A_2) = (\frac{2}{3})^3 \cdot (1 - \frac{2}{3}) \times C_3^1 \cdot \frac{1}{2} \cdot (1 - \frac{1}{2})^3 + C_3^2 \cdot (\frac{2}{3})^2 \cdot (1 - \frac{2}{3}) \cdot \frac{2}{3} \cdot C_4^1 \cdot \frac{1}{2} \cdot (1 - \frac{1}{2})^3 = \frac{5}{54}$ ，

所以 $P(A) = P(A_1) + P(A_2) = \frac{6}{54} = \frac{1}{9}$.

因此，在第 4 轮结束时，学生代表甲答对 3 道题并刚好胜出的概率为 $\frac{1}{9}$.`,
}

const toleratedResult = validate(visuallyToleratedNestedInlinePayload)
assert.equal(toleratedResult.ok, true)
assert.deepEqual(toleratedResult.errors, [])

const rawCommandResult = validate({
  problem_text: '这里会直接露出 \\frac{1}{2}，应当进入格式问题队列。',
  answer: '',
  analysis: '',
})
assert.equal(rawCommandResult.ok, false)
assert.equal(rawCommandResult.errors[0].code, 'raw_latex_outside_math')
assert.ok(rawCommandResult.errors[0].snippet.includes('\\frac{1}{2}'), rawCommandResult.errors[0].snippet)

const bareBecauseBeforeCasesResult = validate({
  problem_text: '',
  answer: '',
  analysis: String.raw`$f'(x)=3+4x+\cdots+(m+2)x^{m-1}$
\because $$\begin{cases} f'(x)=3+4x+\cdots+(m+2)x^{m-1} \\ xf'(x)=3x+4x^2+\cdots+(m+2)x^m \end{cases}
$$
，`,
})
assert.equal(bareBecauseBeforeCasesResult.ok, false)
assert.equal(bareBecauseBeforeCasesResult.errors[0].code, 'raw_latex_outside_math')

const adjacentLogicCommandResult = validate({
  problem_text: '',
  answer: '',
  analysis: String.raw`$\because $\therefore x>0`,
})
assert.equal(adjacentLogicCommandResult.ok, false)
assert.equal(adjacentLogicCommandResult.errors[0].code, 'raw_latex_outside_math')

const adjacentThereforeBecauseResult = validate({
  problem_text: '',
  answer: '',
  analysis: String.raw`$\therefore $\because x>0`,
})
assert.equal(adjacentThereforeBecauseResult.ok, false)
assert.equal(adjacentThereforeBecauseResult.errors[0].code, 'raw_latex_outside_math')

const unclosedResult = validate({
  problem_text: '正常 $A$。',
  answer: '',
  analysis: '前一段 $A \\rightarrow B$ 正常。\n\n真正坏的是这里：$C \\rightarrow B \\rightarrow A',
})
assert.equal(unclosedResult.ok, false)
assert.equal(unclosedResult.errors[0].code, 'math_delimiter_unclosed')
assert.ok(unclosedResult.errors[0].snippet.includes('真正坏的是这里'), unclosedResult.errors[0].snippet)
assert.ok(!unclosedResult.errors[0].snippet.includes('前一段'), unclosedResult.errors[0].snippet)

console.log('validate_math_render tests passed')
