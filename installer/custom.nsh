!include "MUI2.nsh"
!include "nsDialogs.nsh"

!ifndef BUILD_UNINSTALLER
!macro customWelcomePage
  Page custom QuestionManagerFontNoticePage
!macroend

Function QuestionManagerFontNoticePage
  !insertmacro MUI_HEADER_TEXT "字体准备" "PDF 精确预览需要可用的中文字体"
  nsDialogs::Create 1018
  Pop $0

  ${NSD_CreateLabel} 0 0 100% 24u "为避免字体授权风险，Question Manager 不附带 Songti SC、PingFang SC、Kaiti SC 等第三方字体。"
  Pop $0
  ${NSD_CreateLabel} 0 30u 100% 24u "安装后程序会优先使用您已合法安装的字体，并自动回退到 Windows 常见字体或 TeX Live 自带字体。"
  Pop $0
  ${NSD_CreateLabel} 0 60u 100% 24u "如需与 macOS 排版效果完全一致，请自行确认字体许可并在系统中安装相应字体。"
  Pop $0

  nsDialogs::Show
FunctionEnd
!endif
