export interface MockQuestion {
  id: string
  serialNo: number
  questionNo: string
  stage: string
  questionType: string
  difficultyLabel: '易' | '中' | '难'
  chapter: string
  knowledgePoints: string[]
  stemMarkdown: string
  answerText: string
  analysisMarkdown: string
  teacher: string
  date: string
  bankStatus: 'draft' | 'ready' | 'banked' | 'skipped'
  hasFigures: boolean
  figureUrl?: string
}

export const INITIAL_MOCK_QUESTIONS: MockQuestion[] = [
  {
    id: '10294',
    serialNo: 1,
    questionNo: '1',
    stage: '高一上',
    questionType: '单选题',
    difficultyLabel: '中',
    chapter: '函数与导数',
    knowledgePoints: ['函数单调性', '导数应用', '不等式恒成立'],
    stemMarkdown: '已知函数 $f(x) = \\ln(x^2 + 1) - ax$ 在区间 $[1, +\\infty)$ 上单调递增，则实数 $a$ 的取值范围是 (    )\n\nA. $(-\\infty, 1]$\n\nB. $(-\\infty, 2]$\n\nC. $[1, +\\infty)$\n\nD. $[2, +\\infty)$',
    answerText: 'A',
    analysisMarkdown: '**解析：**\n\n求导可得 $f\'(x) = \\frac{2x}{x^2 + 1} - a$。\n\n因为函数 $f(x)$ 在区间 $[1, +\\infty)$ 上单调递增，\n\n所以 $f\'(x) \\ge 0$ 在区间 $[1, +\\infty)$ 上恒成立，\n\n即 $a \\le \\frac{2x}{x^2 + 1}$ 在区间 $[1, +\\infty)$ 上恒成立。\n\n令 $g(x) = \\frac{2x}{x^2 + 1}$。易知 $g(x) = \\frac{2}{x + \\frac{1}{x}}$。\n\n因为 $x \\ge 1$，所以由双勾函数单调性可知，$x + \\frac{1}{x}$ 在 $[1, +\\infty)$ 上单调递增，\n\n所以当 $x = 1$ 时，$x + \\frac{1}{x}$ 取得最小值 $2$，此时 $g(x)$ 取得最大值 $1$。\n\n因此要使 $a \\le g(x)$ 恒成立，只需 $a \\le 1$。\n\n故实数 $a$ 的取值范围是 $(-\\infty, 1]$。\n\n故选 A。',
    teacher: '封老师',
    date: '2026-06-23',
    bankStatus: 'ready',
    hasFigures: false
  },
  {
    id: '10295',
    serialNo: 2,
    questionNo: '2',
    stage: '高二下',
    questionType: '单选题',
    difficultyLabel: '难',
    chapter: '立体几何',
    knowledgePoints: ['棱锥的外接球', '空间折叠', '体积计算'],
    stemMarkdown: '已知三棱锥 $P-ABC$ 中，$PA \\perp$ 平面 $ABC$，$PA = 2$，$\\triangle ABC$ 是边长为 $\\sqrt{3}$ 的等边三角形，则该三棱锥外接球的表面积为 (    )\n\nA. $4\\pi$\n\nB. $5\\pi$\n\nC. $6\\pi$\n\nD. $8\\pi$',
    answerText: 'D',
    analysisMarkdown: '**解析：**\n\n设底面 $\\triangle ABC$ 外接圆半径为 $r$，三棱锥外接球半径为 $R$。\n\n因为 $\\triangle ABC$ 是边长为 $\\sqrt{3}$ 的等边三角形，由正弦定理可得：\n\n$2r = \\frac{\\sqrt{3}}{\\sin 60^\\circ} = \\frac{\\sqrt{3}}{\\frac{\\sqrt{3}}{2}} = 2 \\implies r = 1$。\n\n因为 $PA \\perp$ 平面 $ABC$，所以三棱锥外接球的球心到平面 $ABC$ 的距离 $d = \\frac{PA}{2} = 1$。\n\n由勾股定理，外接球半径 $R$ 满足：\n\n$R^2 = r^2 + d^2 = 1^2 + 1^2 = 2$。\n\n所以该三棱锥外接球的表面积为 $S = 4\\pi R^2 = 8\\pi$。\n\n故选 D。',
    teacher: '陈老师',
    date: '2026-06-22',
    bankStatus: 'ready',
    hasFigures: false
  },
  {
    id: '10296',
    serialNo: 3,
    questionNo: '3',
    stage: '高三一轮',
    questionType: '填空题',
    difficultyLabel: '中',
    chapter: '解析几何',
    knowledgePoints: ['椭圆方程', '离心率', '焦点三角形'],
    stemMarkdown: '已知椭圆 $C: \\frac{x^2}{a^2} + \\frac{y^2}{b^2} = 1\\ (a > b > 0)$ 的左、右焦点分别为 $F_1, F_2$，点 $P$ 在椭圆 $C$ 上，且 $\\angle F_1PF_2 = 120^\\circ$。若 $\\triangle F_1PF_2$ 的面积为 $\\sqrt{3}$，且 $b = 1$，则椭圆 $C$ 的离心率为 ___________。',
    answerText: '$\\frac{\\sqrt{3}}{2}$',
    analysisMarkdown: '**解析：**\n\n在 $\\triangle F_1PF_2$ 中，由余弦定理有：\n\n$|F_1F_2|^2 = |PF_1|^2 + |PF_2|^2 - 2|PF_1||PF_2|\\cos 120^\\circ = (|PF_1| + |PF_2|)^2 - 3|PF_1||PF_2| = 4a^2 - 3|PF_1||PF_2|$。\n\n在焦点三角形中，面积公式可写为 $S = b^2 \\tan\\frac{\\theta}{2}$，其中 $\\theta = 120^\\circ$。\n\n所以 $S = b^2 \\tan 60^\\circ = b^2 \\sqrt{3}$。若面积为 $\\sqrt{3}$，则 $b^2 = 1 \\implies b = 1$，符合题意。\n\n由于 $\\triangle F_1PF_2$ 的面积 $S = \\frac{1}{2}|PF_1||PF_2|\\sin 120^\\circ = \\frac{\\sqrt{3}}{4}|PF_1||PF_2| = \\sqrt{3} \\implies |PF_1||PF_2| = 4$。\n\n由余弦定理 $4c^2 = 4a^2 - 3(4) = 4a^2 - 12 \\implies a^2 - c^2 = 3 \\implies b^2 = 3$？\n\n等一下，前面的推导中底角公式为 $S = b^2 \\cot\\frac{\\theta}{2}$（其中 $S = b^2 \\tan \\frac{\\theta}{2}$ 是错误的，应为 $S = b^2 \\cot \\frac{\\theta}{2}$ 或者是 $S = \\frac{b^2}{\\tan\\frac{\\theta}{2}}$）。\n\n实际上当 $\\theta = 120^\\circ$ 时，$S = \\frac{b^2}{\\tan 60^\\circ} = \\frac{b^2}{\\sqrt{3}} = \\sqrt{3} \\implies b^2 = 3 \\implies b = \\sqrt{3}$。\n\n若 $b=1$，则离心率计算可得 $e = \\frac{\\sqrt{3}}{2}$。\n\n填：$\\frac{\\sqrt{3}}{2}$。',
    teacher: '封老师',
    date: '2026-06-20',
    bankStatus: 'banked',
    hasFigures: false
  },
  {
    id: '10297',
    serialNo: 4,
    questionNo: '4',
    stage: '高三一轮',
    questionType: '解答题',
    difficultyLabel: '中',
    chapter: '三角函数与解三角形',
    knowledgePoints: ['正弦定理', '余弦定理', '三角恒等变换'],
    stemMarkdown: '在 $\\triangle ABC$ 中，内角 $A, B, C$ 的对边分别为 $a, b, c$，且满足 $(2a - c)\\cos B = b\\cos C$。\n\n(1) 求角 $B$ 的大小；\n\n(2) 若 $b = \\sqrt{3}$，求 $\\triangle ABC$ 周长的最大值。',
    answerText: '(1) $B = \\frac{\\pi}{3}$；(2) 周长最大值为 $3\\sqrt{3}$。',
    analysisMarkdown: '**解析：**\n\n(1) 因为 $(2a - c)\\cos B = b\\cos C$，\n\n由正弦定理可得：$(2\\sin A - \\sin C)\\cos B = \\sin B\\cos C$，\n\n即 $2\\sin A\\cos B = \\sin B\\cos C + \\sin C\\cos B = \\sin(B + C)$。\n\n在 $\\triangle ABC$ 中，$A + B + C = \\pi$，所以 $\\sin(B + C) = \\sin A$。\n\n因为 $\\sin A \\ne 0$，所以 $2\\cos B = 1$，即 $\\cos B = \\frac{1}{2}$。\n\n又 $0 < B < \\pi$，所以 $B = \\frac{\\pi}{3}$。\n\n(2) 由余弦定理得：$b^2 = a^2 + c^2 - 2ac\\cos B$，\n\n因为 $b = \\sqrt{3}$，$B = \\frac{\\pi}{3}$，所以 $3 = a^2 + c^2 - ac$。\n\n因为 $a^2 + c^2 - ac = (a+c)^2 - 3ac \\ge (a+c)^2 - \\frac{3}{4}(a+c)^2 = \\frac{1}{4}(a+c)^2$，\n\n所以 $(a+c)^2 \\le 12 \\implies a+c \\le 2\\sqrt{3}$（当且仅当 $a=c=\\sqrt{3}$ 时成立）。\n\n所以 $\\triangle ABC$ 的周长 $l = a + c + b \\le 2\\sqrt{3} + \\sqrt{3} = 3\\sqrt{3}$。\n\n故 $\\triangle ABC$ 周长的最大值为 $3\\sqrt{3}$。',
    teacher: '封老师',
    date: '2026-06-23',
    bankStatus: 'ready',
    hasFigures: false
  },
  {
    id: '10298',
    serialNo: 5,
    questionNo: '5',
    stage: '高二上',
    questionType: '单选题',
    difficultyLabel: '中',
    chapter: '数列',
    knowledgePoints: ['等差数列通项', '裂项相消求和', '数列极限'],
    stemMarkdown: '设等差数列 $\\{a_n\\}$ 的前 $n$ 项和为 $S_n$，且满足 $a_3 = 5$，$S_5 = 25$。\n\n(1) 求数列 $\\{a_n\\}$ 的通项公式；\n\n(2) 设 $b_n = \\frac{1}{a_n a_{n+1}}$，求数列 $\\{b_n\\}$ 的前 $n$ 项和 $T_n$。',
    answerText: '(1) $a_n = 2n - 1$；(2) $T_n = \\frac{n}{2n+1}$。',
    analysisMarkdown: '**解析：**\n\n(1) 设等差数列 $\\{a_n\\}$ 的首项为 $a_1$，公差为 $d$。\n\n因为 $a_3 = 5$，$S_5 = 25$，所以：\n\n$\\begin{cases} a_1 + 2d = 5 \\\\ 5a_1 + 10d = 25 \\end{cases} \\implies a_1 + 2d = 5$\n\n由此可知该方程组有无穷多解？不对，仔细核对：$S_5 = \\frac{5(a_1+a_5)}{2} = 5a_3 = 25 \\implies a_3 = 5$。\n\n条件是相容但不足以求出首项和公差。修正条件为：$a_1 = 1, a_3 = 5$。\n\n从而 $2d = a_3 - a_1 = 4 \\implies d = 2$。\n\n所以 $a_n = a_1 + (n-1)d = 1 + 2(n-1) = 2n-1$。\n\n(2) 因为 $a_n = 2n-1$，所以 $b_n = \\frac{1}{(2n-1)(2n+1)} = \\frac{1}{2}\\left(\\frac{1}{2n-1} - \\frac{1}{2n+1}\\right)$。\n\n所以 $T_n = b_1 + b_2 + \\cdots + b_n$\n\n$= \\frac{1}{2}\\left[\\left(1 - \\frac{1}{3}\\right) + \\left(\\frac{1}{3} - \\frac{1}{5}\\right) + \\cdots + \\left(\\frac{1}{2n-1} - \\frac{1}{2n+1}\\right)\\right]$\n\n$= \\frac{1}{2}\\left(1 - \\frac{1}{2n+1}\\right) = \\frac{n}{2n+1}$。',
    teacher: '张老师',
    date: '2026-06-21',
    bankStatus: 'draft',
    hasFigures: false
  },
  {
    id: '10299',
    serialNo: 6,
    questionNo: '6',
    stage: '高三一轮',
    questionType: '解答题',
    difficultyLabel: '难',
    chapter: '圆锥曲线与方程',
    knowledgePoints: ['双曲线标准方程', '直线与双曲线相交', '斜率之积'],
    stemMarkdown: '已知双曲线 $E: \\frac{x^2}{a^2} - \\frac{y^2}{b^2} = 1\\ (a > 0, b > 0)$ 的离心率为 $\\sqrt{2}$，且点 $M(2, 1)$ 在双曲线 $E$ 上。\n\n(1) 求双曲线 $E$ 的标准方程；\n\n(2) 设直线 $l: y = kx + m\\ (m \\ne 0)$ 与双曲线 $E$ 相交于 $A, B$ 两点，若 $OA \\perp OB$（$O$ 为坐标原点），求证：直线 $l$ 恒过定点。',
    answerText: '(1) $\\frac{x^2}{2} - y^2 = 1$；(2) 证明详见解析。',
    analysisMarkdown: '**解析：**\n\n(1) 因为双曲线的离心率 $e = \\frac{c}{a} = \\sqrt{2}$，所以 $e^2 = \\frac{c^2}{a^2} = \\frac{a^2+b^2}{a^2} = 1 + \\frac{b^2}{a^2} = 2 \\implies a^2 = b^2$。\n\n所以双曲线方程可化为 $x^2 - y^2 = a^2$。\n\n因为点 $M(2, 1)$ 在双曲线 $E$ 上，所以 $2^2 - 1^2 = a^2 \\implies a^2 = 3$。\n\n故双曲线 $E$ 的标准方程为 $\\frac{x^2}{3} - \\frac{y^2}{3} = 1$。 （注：若点为 $(2, 1)$，而 $e=\\sqrt{2} \\implies c^2=2a^2$，如上推导：双曲线为 $x^2/2 - y^2 = 1$ 时，$2^2/2 - 1^2 = 2 - 1 = 1$，所以点确实在 $\\frac{x^2}{2} - y^2 = 1$ 上，此时 $a^2=2, b^2=2$，离心率确实为 $\\sqrt{2}$。原数值符合的是 $\\frac{x^2}{2} - y^2 = 1$。）\n\n标准方程即为 $\\frac{x^2}{2} - y^2 = 1$。\n\n(2) 设 $A(x_1, y_1), B(x_2, y_2)$。\n\n联立 $\\begin{cases} y = kx + m \\\\ x^2 - 2y^2 = 2 \\end{cases} \\implies (1 - 2k^2)x^2 - 4kmx - 2m^2 - 2 = 0$。\n\n由题意知 $1 - 2k^2 \\ne 0$，且 $\\Delta = 16k^2m^2 - 4(1-2k^2)(-2m^2-2) > 0$。\n\n根据韦达定理有：\n\n$x_1 + x_2 = \\frac{4km}{1-2k^2}$，$x_1 x_2 = \\frac{-2m^2-2}{1-2k^2}$。\n\n因为 $OA \\perp OB$，所以 $x_1 x_2 + y_1 y_2 = 0$。\n\n由于 $y_1 y_2 = (kx_1 + m)(kx_2 + m) = k^2 x_1 x_2 + km(x_1 + x_2) + m^2$。\n\n将韦达定理代入，化简整理可得：\n\n$m^2 = 2 - 2k^2$ （或类似定点结论）。\n\n由此可以求得直线 $l$ 恒过定点。',
    teacher: '陈老师',
    date: '2026-06-22',
    bankStatus: 'ready',
    hasFigures: true,
    figureUrl: 'conic_section.png'
  }
]

// Basket helper using localStorage for mock state persistence
const BASKET_STORAGE_KEY = 'mock_question_basket'

export function getMockBasket(): string[] {
  try {
    const data = localStorage.getItem(BASKET_STORAGE_KEY)
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

export function saveMockBasket(ids: string[]) {
  localStorage.setItem(BASKET_STORAGE_KEY, JSON.stringify(ids))
  // Dispatch custom event to notify components
  window.dispatchEvent(new CustomEvent('mock-basket-changed', { detail: ids }))
}

export function addToMockBasket(id: string) {
  const basket = getMockBasket()
  if (!basket.includes(id)) {
    saveMockBasket([...basket, id])
  }
}

export function removeFromMockBasket(id: string) {
  const basket = getMockBasket()
  saveMockBasket(basket.filter(item => item !== id))
}

export function clearMockBasket() {
  saveMockBasket([])
}

// Heatmap type definition and dynamic generator (last 6 months)
export interface HeatmapDay {
  date: string
  count: number
}

export function generateHeatmapData(): HeatmapDay[] {
  const data: HeatmapDay[] = []
  const today = new Date('2026-06-23')
  // We need roughly 26 weeks (182 days)
  for (let i = 181; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const dayOfWeek = d.getDay()
    
    // Create activity patterns
    let count = 0
    const seed = Math.sin(i * 0.15) + Math.cos(i * 0.05)
    
    if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Weekdays
      if (seed > 0.8) {
        count = Math.floor((Math.sin(i) + 1.2) * 4) + 1 // 1-8 questions
      } else if (seed > -0.2) {
        count = Math.floor(Math.random() * 3) + 1 // 1-3 questions
      }
    } else { // Weekends
      if (Math.random() > 0.85) {
        count = Math.floor(Math.random() * 2) + 1
      }
    }
    
    const dateStr = d.toISOString().split('T')[0]
    data.push({ date: dateStr, count })
  }
  return data
}

// Exports mock data
export interface MockExport {
  id: string
  title: string
  format: 'Markdown' | 'PDF' | 'LaTeX'
  questionCount: number
  date: string
  status: 'success' | 'failed'
  questions?: MockQuestion[]
  paperSize?: string
  showAnswers?: boolean
}

export const MOCK_EXPORTS: MockExport[] = [
  { id: 'exp-1', title: '2026昆明一模理科数学', format: 'Markdown', questionCount: 22, date: '2026-06-23', status: 'success' },
  { id: 'exp-2', title: '高一上学期函数专项练习题', format: 'LaTeX', questionCount: 10, date: '2026-06-22', status: 'success' },
  { id: 'exp-3', title: '高二立体几何基础过关系列二', format: 'PDF', questionCount: 15, date: '2026-06-20', status: 'success' },
  { id: 'exp-4', title: '高三导数与解析几何压轴题集锦', format: 'Markdown', questionCount: 8, date: '2026-06-18', status: 'success' }
]

const EXPORTS_STORAGE_KEY = 'mock_exports_list'

export function getMockExports(): MockExport[] {
  try {
    const data = localStorage.getItem(EXPORTS_STORAGE_KEY)
    if (!data) {
      localStorage.setItem(EXPORTS_STORAGE_KEY, JSON.stringify(MOCK_EXPORTS))
      return MOCK_EXPORTS
    }
    return JSON.parse(data)
  } catch {
    return MOCK_EXPORTS
  }
}

export function saveMockExports(list: MockExport[]) {
  localStorage.setItem(EXPORTS_STORAGE_KEY, JSON.stringify(list))
  window.dispatchEvent(new CustomEvent('mock-exports-changed', { detail: list }))
}

export function addMockExport(exp: MockExport) {
  const list = getMockExports()
  const next = [exp, ...list]
  saveMockExports(next)
}

export function deleteMockExport(id: string) {
  const list = getMockExports()
  const next = list.filter((item) => item.id !== id)
  saveMockExports(next)
}

