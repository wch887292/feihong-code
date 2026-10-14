@echo off
title fhcode - Cline Panel
cd /d "H:\feihong-code"
node dist\cli\index.js cline
if errorlevel 1 pause