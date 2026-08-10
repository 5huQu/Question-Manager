import type { PaperKind, SourceMetadataDraft } from '@/api/importV2'
import { SearchableSelect } from '@/components/SearchableSelect'
import { Panel } from '@/components/ui'
import { cityOptionsForProvince, provinceForCity, provinceOptions } from '@/utils/metadataOptions'
import { gaokaoRegionOptions, isGaokaoRegion, paperKindOptions } from './constants'
import type { ImportUploadState } from './useImportUpload'

interface MetadataFormPanelProps {
  state: ImportUploadState
}

export function MetadataFormPanel({ state }: MetadataFormPanelProps) {
  const {
    metadataDraft,
    setMetadataDraft,
    yearOptions,
    stageOptions,
    selectedStage,
    metadataSubject,
    visibleSubjectOptions,
    visibleCityOptions,
  } = state

  const inputClass =
    'h-9 w-full rounded-xl border border-black/10 bg-white/90 px-3 text-xs font-medium text-zinc-900 shadow-2xs outline-none transition-all focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 placeholder:text-zinc-400 dark:border-white/12 dark:bg-zinc-900/90 dark:text-zinc-100 dark:focus:border-zinc-100'

  return (
    <div className="md:col-span-5">
      <Panel title="试卷信息与元数据" className="overflow-visible" bodyClassName="overflow-visible">
        <div className="space-y-4">
          {/* 主要信息区 */}
          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">试卷名称</span>
              <input
                className={`${inputClass} h-9.5 text-xs font-semibold`}
                value={metadataDraft.paperTitle}
                onChange={(e) => setMetadataDraft((d) => ({ ...d, paperTitle: e.target.value }))}
                placeholder="请输入试卷或练习的完整标题"
              />
            </label>

            {/* 核心分类：学段、学科、年份 */}
            <div className="grid grid-cols-3 gap-2.5">
              <label className="space-y-1">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">学段/年级</span>
                <SearchableSelect
                  value={selectedStage}
                  options={stageOptions}
                  onChange={(stage) => setMetadataDraft((d) => ({ ...d, stage }))}
                  placeholder="选择学段"
                  searchPlaceholder="搜索学段"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">学科</span>
                <select
                  className={inputClass}
                  value={metadataSubject}
                  onChange={(e) => setMetadataDraft((d) => ({ ...d, subject: e.target.value }))}
                >
                  {visibleSubjectOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">年份</span>
                <SearchableSelect
                  value={String(metadataDraft.examYear)}
                  options={yearOptions}
                  onChange={(examYear) => setMetadataDraft((d) => ({ ...d, examYear }))}
                  placeholder="选择年份"
                  searchPlaceholder="搜索年份"
                />
              </label>
            </div>
          </div>

          {/* 次级元数据区 */}
          <div className="border-t border-black/6 dark:border-white/8 pt-3.5 space-y-3">
            <label className="block space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">批次名称</span>
                <span className="text-[11px] text-zinc-400 font-normal">可选 · 不填默认与试卷名称相同</span>
              </div>
              <input
                className={inputClass}
                value={metadataDraft.batchName}
                onChange={(e) => setMetadataDraft((d) => ({ ...d, batchName: e.target.value }))}
                placeholder="不填默认与试卷名称相同"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 col-span-2 sm:col-span-1">
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">资料类型</span>
                <select
                  className={inputClass}
                  value={metadataDraft.paperKind}
                  onChange={(e) =>
                    setMetadataDraft((d) => {
                      const paperKind = e.target.value as PaperKind
                      if (paperKind === 'gaokao_real') {
                        return { ...d, paperKind, province: isGaokaoRegion(d.province) ? d.province : '', city: '', sourceOrg: '' }
                      }
                      return { ...d, paperKind }
                    })
                  }
                >
                  {paperKindOptions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              {metadataDraft.paperKind === 'gaokao_real' ? (
                <label className="col-span-2 space-y-1">
                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">试卷适用地区</span>
                  <SearchableSelect
                    value={isGaokaoRegion(metadataDraft.province) ? metadataDraft.province : ''}
                    options={gaokaoRegionOptions.map((item) => item.value)}
                    onChange={(province) => setMetadataDraft((d) => ({ ...d, province, city: '', sourceOrg: '' }))}
                    placeholder="请选择全国卷或直辖市"
                    searchPlaceholder="搜索全国卷或地区"
                    allowClear
                  />
                  {gaokaoRegionOptions.find((item) => item.value === metadataDraft.province)?.provinces && (
                    <p className="text-[11px] leading-4 text-zinc-400">
                      {gaokaoRegionOptions.find((item) => item.value === metadataDraft.province)?.provinces}
                    </p>
                  )}
                </label>
              ) : (
                <>
                  <label className="space-y-1 col-span-2 sm:col-span-1">
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">来源机构</span>
                    <input
                      className={inputClass}
                      value={metadataDraft.sourceOrg}
                      onChange={(e) => setMetadataDraft((d) => ({ ...d, sourceOrg: e.target.value }))}
                      placeholder="例如：金太阳联考"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">省份</span>
                    <SearchableSelect
                      value={metadataDraft.province}
                      options={provinceOptions}
                      onChange={(province) =>
                        setMetadataDraft((d) => ({
                          ...d,
                          province,
                          city: cityOptionsForProvince(province).includes(d.city) ? d.city : '',
                        }))
                      }
                      placeholder="选择省份"
                      searchPlaceholder="搜索省份"
                      allowClear
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">城市</span>
                    <SearchableSelect
                      value={metadataDraft.city}
                      options={visibleCityOptions}
                      onChange={(city) => setMetadataDraft((d) => ({ ...d, city, province: provinceForCity(city) || d.province }))}
                      placeholder={metadataDraft.province ? '选择城市' : '先选省份'}
                      searchPlaceholder="搜索城市"
                      allowClear
                    />
                  </label>
                </>
              )}
            </div>
          </div>

          {/* 水印与高级设置 */}
          <div className="rounded-xl border border-black/6 bg-black/[0.02] p-3 space-y-2 dark:border-white/8 dark:bg-white/[0.02]">
            <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                className="size-4 rounded border-black/10 text-zinc-900 focus:ring-zinc-900 dark:border-white/12 cursor-pointer"
                checked={metadataDraft.hasWatermark}
                onChange={(e) => setMetadataDraft((d) => ({ ...d, hasWatermark: e.target.checked }))}
              />
              文档含有去水印背景词
            </label>
            {metadataDraft.hasWatermark && (
              <label className="block space-y-1.5 pt-1">
                <span className="text-[11px] font-medium text-zinc-500">水印排除词典</span>
                <textarea
                  className="min-h-18 w-full resize-y rounded-xl border border-black/10 bg-white/90 p-2.5 text-xs outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 placeholder:text-zinc-400 dark:border-white/12 dark:bg-zinc-900/90 dark:text-zinc-100"
                  value={metadataDraft.watermarkTerms}
                  onChange={(e) => setMetadataDraft((d) => ({ ...d, watermarkTerms: e.target.value }))}
                  placeholder="每行输入一个去水印排除词，例如：鼎尖教育"
                />
              </label>
            )}
          </div>
        </div>
      </Panel>
    </div>
  )
}
