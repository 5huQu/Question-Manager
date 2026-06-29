export function yearOptionsFromServerYear(serverYear?: number) {
  const currentYear = Number.isFinite(serverYear) && serverYear ? serverYear : new Date().getFullYear()
  return Array.from({ length: 31 }, (_, index) => String(currentYear - 30 + index))
}

export type ProvinceCityOption = {
  province: string
  cities: string[]
}

export const provinceCityOptions: ProvinceCityOption[] = [
  { province: '北京', cities: ['北京'] },
  { province: '天津', cities: ['天津'] },
  { province: '河北', cities: ['石家庄', '唐山', '秦皇岛', '邯郸', '邢台', '保定', '张家口', '承德', '沧州', '廊坊', '衡水'] },
  { province: '山西', cities: ['太原', '大同', '阳泉', '长治', '晋城', '朔州', '晋中', '运城', '忻州', '临汾', '吕梁'] },
  { province: '内蒙古', cities: ['呼和浩特', '包头', '乌海', '赤峰', '通辽', '鄂尔多斯', '呼伦贝尔', '巴彦淖尔', '乌兰察布', '兴安盟', '锡林郭勒盟', '阿拉善盟'] },
  { province: '辽宁', cities: ['沈阳', '大连', '鞍山', '抚顺', '本溪', '丹东', '锦州', '营口', '阜新', '辽阳', '盘锦', '铁岭', '朝阳', '葫芦岛'] },
  { province: '吉林', cities: ['长春', '吉林', '四平', '辽源', '通化', '白山', '松原', '白城', '延边'] },
  { province: '黑龙江', cities: ['哈尔滨', '齐齐哈尔', '鸡西', '鹤岗', '双鸭山', '大庆', '伊春', '佳木斯', '七台河', '牡丹江', '黑河', '绥化', '大兴安岭'] },
  { province: '上海', cities: ['上海'] },
  { province: '江苏', cities: ['南京', '无锡', '徐州', '常州', '苏州', '南通', '连云港', '淮安', '盐城', '扬州', '镇江', '泰州', '宿迁'] },
  { province: '浙江', cities: ['杭州', '宁波', '温州', '嘉兴', '湖州', '绍兴', '金华', '衢州', '舟山', '台州', '丽水'] },
  { province: '安徽', cities: ['合肥', '芜湖', '蚌埠', '淮南', '马鞍山', '淮北', '铜陵', '安庆', '黄山', '滁州', '阜阳', '宿州', '六安', '亳州', '池州', '宣城'] },
  { province: '福建', cities: ['福州', '厦门', '莆田', '三明', '泉州', '漳州', '南平', '龙岩', '宁德'] },
  { province: '江西', cities: ['南昌', '景德镇', '萍乡', '九江', '新余', '鹰潭', '赣州', '吉安', '宜春', '抚州', '上饶'] },
  { province: '山东', cities: ['济南', '青岛', '淄博', '枣庄', '东营', '烟台', '潍坊', '济宁', '泰安', '威海', '日照', '临沂', '德州', '聊城', '滨州', '菏泽'] },
  { province: '河南', cities: ['郑州', '开封', '洛阳', '平顶山', '安阳', '鹤壁', '新乡', '焦作', '濮阳', '许昌', '漯河', '三门峡', '南阳', '商丘', '信阳', '周口', '驻马店', '济源'] },
  { province: '湖北', cities: ['武汉', '黄石', '十堰', '宜昌', '襄阳', '鄂州', '荆门', '孝感', '荆州', '黄冈', '咸宁', '随州', '恩施', '仙桃', '潜江', '天门', '神农架'] },
  { province: '湖南', cities: ['长沙', '株洲', '湘潭', '衡阳', '邵阳', '岳阳', '常德', '张家界', '益阳', '郴州', '永州', '怀化', '娄底', '湘西'] },
  { province: '广东', cities: ['广州', '深圳', '珠海', '汕头', '佛山', '韶关', '湛江', '肇庆', '江门', '茂名', '惠州', '梅州', '汕尾', '河源', '阳江', '清远', '东莞', '中山', '潮州', '揭阳', '云浮'] },
  { province: '广西', cities: ['南宁', '柳州', '桂林', '梧州', '北海', '防城港', '钦州', '贵港', '玉林', '百色', '贺州', '河池', '来宾', '崇左'] },
  { province: '海南', cities: ['海口', '三亚', '三沙', '儋州', '五指山', '琼海', '文昌', '万宁', '东方'] },
  { province: '重庆', cities: ['重庆'] },
  { province: '四川', cities: ['成都', '自贡', '攀枝花', '泸州', '德阳', '绵阳', '广元', '遂宁', '内江', '乐山', '南充', '眉山', '宜宾', '广安', '达州', '雅安', '巴中', '资阳', '阿坝', '甘孜', '凉山'] },
  { province: '贵州', cities: ['贵阳', '六盘水', '遵义', '安顺', '毕节', '铜仁', '黔西南', '黔东南', '黔南'] },
  { province: '云南', cities: ['昆明', '曲靖', '玉溪', '保山', '昭通', '丽江', '普洱', '临沧', '楚雄', '红河', '文山', '西双版纳', '大理', '德宏', '怒江', '迪庆'] },
  { province: '西藏', cities: ['拉萨', '日喀则', '昌都', '林芝', '山南', '那曲', '阿里'] },
  { province: '陕西', cities: ['西安', '铜川', '宝鸡', '咸阳', '渭南', '延安', '汉中', '榆林', '安康', '商洛'] },
  { province: '甘肃', cities: ['兰州', '嘉峪关', '金昌', '白银', '天水', '武威', '张掖', '平凉', '酒泉', '庆阳', '定西', '陇南', '临夏', '甘南'] },
  { province: '青海', cities: ['西宁', '海东', '海北', '黄南', '海南', '果洛', '玉树', '海西'] },
  { province: '宁夏', cities: ['银川', '石嘴山', '吴忠', '固原', '中卫'] },
  { province: '新疆', cities: ['乌鲁木齐', '克拉玛依', '吐鲁番', '哈密', '昌吉', '博尔塔拉', '巴音郭楞', '阿克苏', '克孜勒苏', '喀什', '和田', '伊犁', '塔城', '阿勒泰', '石河子', '阿拉尔', '图木舒克', '五家渠', '北屯', '铁门关', '双河', '可克达拉', '昆玉', '胡杨河'] },
  { province: '香港', cities: ['香港'] },
  { province: '澳门', cities: ['澳门'] },
  { province: '台湾', cities: ['台北', '新北', '桃园', '台中', '台南', '高雄', '基隆', '新竹', '嘉义'] },
]

export const provinceOptions = provinceCityOptions.map((item) => item.province)

export function cityOptionsForProvince(province: string) {
  const matched = provinceCityOptions.find((item) => item.province === province)
  if (matched) return matched.cities
  return Array.from(new Set(provinceCityOptions.flatMap((item) => item.cities)))
}
