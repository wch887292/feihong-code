@echo off
title fhcode - Cline Panel
cd /d "H:\Muse Code复刻"
node dist\cli\index.js cline
if errorlevel 1 pause