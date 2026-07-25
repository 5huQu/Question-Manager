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

  return (
    <div className="md:col-span-6">
      <Panel title="试卷信息与元数据" className="overflow-visible" bodyClassName="overflow-visible">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5 col-span-2">
              <span className="text-[13px] font-medium text-zinc-500">试卷名称</span>
              <input
                className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800"
                value={metadataDraft.paperTitle}
                onChange={(e) => setMetadataDraft((d) => ({ ...d, paperTitle: e.target.value }))}
                placeholder="请输入试卷或练习的完整标题"
              />
            </label>
            <label className="space-y-1.5 col-span-2">
              <span className="text-[13px] font-medium text-zinc-500">批次名称</span>
              <input
                className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800"
                value={metadataDraft.batchName}
                onChange={(e) => setMetadataDraft((d) => ({ ...d, batchName: e.target.value }))}
                placeholder="可选，不填默认与试卷名称相同"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-[13px] font-medium text-zinc-500">学段/年级</span>
              <SearchableSelect
                value={selectedStage}
                options={stageOptions}
                onChange={(stage) => setMetadataDraft((d) => ({ ...d, stage }))}
                placeholder="请选择学段"
                searchPlaceholder="搜索学段"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-[13px] font-medium text-zinc-500">学科</span>
              <select
                className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800"
                value={metadataSubject}
                onChange={(e) => setMetadataDraft((d) => ({ ...d, subject: e.target.value }))}
              >
                {visibleSubjectOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-[13px] font-medium text-zinc-500">资料类型</span>
              <select
                className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800"
                value={metadataDraft.paperKind}
                onChange={(e) => setMetadataDraft((d) => {
                  const paperKind = e.target.value as PaperKind
                  if (paperKind === 'gaokao_real') {
                    return { ...d, paperKind, province: isGaokaoRegion(d.province) ? d.province : '', city: '', sourceOrg: '' }
                  }
                  return { ...d, paperKind }
                })}
              >
                {paperKindOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-[13px] font-medium text-zinc-500">年份</span>
              <SearchableSelect
                value={String(metadataDraft.examYear)}
                options={yearOptions}
                onChange={(examYear) => setMetadataDraft((d) => ({ ...d, examYear }))}
                placeholder="请选择年份"
                searchPlaceholder="搜索年份"
              />
            </label>

            {metadataDraft.paperKind === 'gaokao_real' ? (
              <label className="col-span-2 space-y-1.5">
                <span className="text-[13px] font-medium text-zinc-500">试卷适用地区</span>
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
                <label className="space-y-1.5">
                  <span className="text-[13px] font-medium text-zinc-500">省份</span>
                  <SearchableSelect
                    value={metadataDraft.province}
                    options={provinceOptions}
                    onChange={(province) => setMetadataDraft((d) => ({ ...d, province, city: cityOptionsForProvince(province).includes(d.city) ? d.city : '' }))}
                    placeholder="请选择省份"
                    searchPlaceholder="搜索省份"
                    allowClear
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-[13px] font-medium text-zinc-500">城市</span>
                  <SearchableSelect
                    value={metadataDraft.city}
                    options={visibleCityOptions}
                    onChange={(city) => setMetadataDraft((d) => ({ ...d, city, province: provinceForCity(city) || d.province }))}
                    placeholder={metadataDraft.province ? '请选择城市' : '可先选择省份'}
                    searchPlaceholder="搜索城市"
                    allowClear
                  />
                </label>
                <label className="col-span-2 space-y-1.5">
                  <span className="text-[13px] font-medium text-zinc-500">来源机构</span>
                  <input
                    className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800"
                    value={metadataDraft.sourceOrg}
                    onChange={(e) => setMetadataDraft((d) => ({ ...d, sourceOrg: e.target.value }))}
                    placeholder="例如：金太阳联考"
                  />
                </label>
              </>
            )}
          </div>

          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3.5 space-y-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200 cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-700"
                checked={metadataDraft.hasWatermark}
                onChange={(e) => setMetadataDraft((d) => ({ ...d, hasWatermark: e.target.checked }))}
              />
              文档含有去水印背景词
            </label>
            {metadataDraft.hasWatermark && (
              <label className="block space-y-1.5">
                <span className="text-[11px] font-medium text-zinc-500">水印排除词典</span>
                <textarea
                  className="min-h-20 w-full resize-y rounded-md border border-zinc-200 bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800"
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
