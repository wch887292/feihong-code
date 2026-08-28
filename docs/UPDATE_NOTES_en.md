# Feihong Code v7.0.0 Release Notes

**Release Date**: August 24, 2026
**Version**: 7.6.0
**Product Name**: Feihong Code (feihong-code)
**R&D Team**: Feihongzhi Technology Enterprise Management Co., Ltd. · Feiyang Qiyuan R&D Center

---

## Version Overview

Feihong Code v7.0.0 is a major version upgrade, jumping directly from 0.6.1 to 7.0.0, marking the product's mature transformation from a terminal tool to a full-platform AI coding assistant. This release focuses on optimizing user experience, adding desktop support, improving multilingual internationalization, and significantly enhancing the naturalness of conversational interaction.

---

## Key Highlights

### 1. Complete Conversation Flow Refactoring (Doubao-like Experience)

- **Pure Text Output**: Completely removed Markdown formatting, tool call status, technical summaries, and other distracting information
- **Real-time Thinking Process**: Model's thinking process displayed in real-time, letting users see what the AI is thinking
- **Conversational Tone**: Natural like human conversation, no longer technical report style
- **Hidden Operation Steps**: No longer shows "Executing operation: read_file, run_shell" and other technical details
- **Separation of Thinking and Reply**: Thinking process displayed in real-time, final reply concise and clear, no repetition

### 2. Electron Desktop Version Officially Released

- **Independent Desktop Window**: No longer dependent on browser, double-click to use
- **System Tray Support**: Minimize to background, invoke anytime
- **Single Instance Prevention**: Single instance operation, avoiding resource waste
- **Application Menu**: Complete edit menu (copy/paste/cut/select all)
- **Permission Management**: Microphone, camera, screen capture permissions automatically handled
- **One-click Startup Script**: `一键启动桌面版.bat`, auto build + launch

### 3. Interface and Interaction Optimization

- **Interface Width Optimization**: Main area max width 1400px, no longer fills the entire screen
- **User Menu Refactored**: Changed from bottom pull-up to right sidebar (280px)
- **Startup Logic Fixed**: No longer opens two web pages, one launch directly enters
- **Text Selection Copy**: Support selecting partial text for copying, no longer only whole message copy
- **Message Action Buttons**: Hover to show copy, create document buttons
- **Conversation History Expansion**: conversation limit increased from 80 to 300, steps limit from 200 to 500

### 4. New and Improved Features

- **Screenshot Function**: Support screen capture + crop selection, screenshot directly to input box
- **Computer Control**: Backend PowerShell API, support screenshot, mouse move/click, keyboard input
- **Voice Input**: Web Speech API, recommended to use Edge browser
- **Voice/Video Call**: Real-time microphone recognition + camera view + video snapshot
- **Workspace Picker**: Drives and folders paginated, support create/rename folders
- **Conversation Task Optimization**: Click conversation directly creates new task, no need to manually click new
- **Automation Quick Commands**: Built-in common quick commands
- **Template Library Plugin System**: Support custom sources, nodes connect to external plugins
- **Memory System**: Long-term memory customization, add record simplified to plain text input

### 5. Enhanced Coding and Bug Fixing Capabilities

- **System Prompt Upgrade**: Added 8 coding capability requirements, 7 bug fixing capability requirements
- **Error Classification Optimization**: build-error and other errors provide 5-step specific troubleshooting process
- **Continuous Error Handling**: Traverse all continuous errors for classification recording, no longer only record the last one
- **Self-check Maintenance Optimization**: Only the first task per day can do environment confirmation, subsequent tasks execute directly, only fix when errors occur
- **Build Error Self-healing**: Structured report on failure (error type + last error + fix suggestion + next step)

### 6. Chinese-English Internationalization

- **Backend i18n**: Complete Chinese-English entries
- **Frontend Internationalization**: Computer control, video call, message operations, etc. added Chinese-English translations
- **Continuously Improving**: Some hardcoded text gradually migrated to i18n

### 7. Local Speech Recognition Service (Optional)

- **faster-whisper Local Deployment**: Completely free, offline, no call limits
- **HTTP API Interface**: Any project can call
- **Multilingual Support**: Chinese optimized, high accuracy
- **Independent Service**: Not coupled with main program, start on demand

---

## Bug Fixes

- Fixed Electron desktop version auto-exit issue
- Fixed issue of opening two web pages after startup
- Fixed conversation history too long causing earlier content to be truncated
- Fixed thinking process not displaying in real-time during task execution
- Fixed desktop version copy-paste shortcut failure
- Fixed desktop version screenshot permission repeated request
- Fixed 13389.js s.nodeName.toLowerCase error (non-project code, confirmed not affecting functionality)
- Fixed inaccurate error information after 3 consecutive build errors

---

## Upgrade Guide

### Upgrade from 0.6.1

```bash
# Pull latest code
git pull origin master

# Install dependencies (if any new)
npm install

# Rebuild
npm run build

# Start service
fhcode serve
# or
node dist/cli/index.js serve
```

### Desktop Version Usage

```bash
# Method 1: One-click startup
Double-click 一键启动桌面版.bat

# Method 2: Manual startup
npm run build
npm run electron
```

### Local Speech Recognition Service (Optional)

```bash
cd funasr-server
Double-click 启动语音识别服务.bat
# Service starts at http://localhost:8082
```

---

## System Requirements

- **Node.js**: 18.0 or higher
- **Operating System**: Windows 10/11 (recommended), macOS, Linux
- **Memory**: At least 4GB (8GB recommended)
- **Desktop Version**: Windows 10/11, Electron v41+

---

## Known Limitations

- Desktop version voice input depends on Google services, domestically recommended to use web version (Edge browser) or local speech recognition service
- Computer control feature currently manual operation interface, AI automatic operation under development
- Chinese-English internationalization not yet fully covering all hardcoded text
- Local speech recognition service is non-real-time (recognizes after recording completes)

---

## Feedback and Support

- GitHub Issues: https://github.com/wch887292/feihong-code/issues
- npm: https://www.npmjs.com/package/feihong-code

---

*Feihongzhi Technology Enterprise Management Co., Ltd. · Feiyang Qiyuan R&D Center*
*Person in Charge: Wu Cihong*
