%% qbank-worksheet.cls — 练习单（基于统一品牌底座）
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{qbank-worksheet}[2026/06/18 v1.0 Unified teacher worksheet]
\DeclareOption*{\PassOptionsToClass{\CurrentOption}{ctexart}}
\ProcessOptions\relax
\LoadClass[UTF8,11pt,a4paper]{ctexart}
\RequirePackage{qbank-theme}
\setdoctype{练习单}
\everymath{\displaystyle}
%% 分值标记：\score{10} 右对齐显示在题目元信息行
\newcommand{\score}[1]{{\scriptsize\sffamily\color{brandink!75}（本题 #1 分）}}
\endinput
