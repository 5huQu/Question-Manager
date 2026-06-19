%% qbank-exam.cls — 试卷（基于统一品牌底座）
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{qbank-exam}[2026/06/18 v1.0 Unified teacher exam paper]
\newif\ifqbankshowsolutions
\qbankshowsolutionsfalse
\DeclareOption{solutions}{\qbankshowsolutionstrue}
\DeclareOption*{\PassOptionsToClass{\CurrentOption}{ctexart}}
\ProcessOptions\relax
\LoadClass[UTF8,11pt,a4paper]{ctexart}
\RequirePackage{qbank-theme}
\setdoctype{试卷}
\everymath{\displaystyle}
\endinput
