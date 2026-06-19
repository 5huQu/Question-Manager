%% qbank-lecture.cls — 讲义（基于统一品牌底座）
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{qbank-lecture}[2026/06/18 v1.0 Unified teacher lecture notes]
\DeclareOption*{\PassOptionsToClass{\CurrentOption}{ctexart}}
\ProcessOptions\relax
\LoadClass[UTF8,11pt,a4paper]{ctexart}
\RequirePackage{qbank-theme}
\setdoctype{讲义}
\endinput
