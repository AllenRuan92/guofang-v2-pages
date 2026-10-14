(function(root) {
  "use strict";
  function preferenceIntent(text) {
    text=String(text || "").trim();
    if (!/^(?:请|帮我|麻烦)?\s*(?:以后|今后|从现在起|记住|默认|我(?:更)?喜欢|这次|本次|当前任务|忘记|不要再记|取消.{0,12}偏好)/.test(text)) return false;
    return /偏好|习惯|小数|精度|格式|展示|显示|列示|排版|字体|措辞|语气|口吻|标题|篇幅|简洁|简短|详细|先.{0,4}结论|文字密度|(?:金额|单位).{0,12}(?:用|以|按)(?:亿元|万元|元)|(?:保留|改为|改成|用)[0-6零一二两三四五六]位|为单位/.test(text);
  }
  if (typeof module === "object" && module.exports) module.exports={preferenceIntent};
  else root.wenshuPreferenceIntent=preferenceIntent;
})(typeof globalThis === "object" ? globalThis : this);
