# -*- coding: utf-8 -*-
"""
Agnes AI Studio API 统一调用客户端
封装生图、生视频、短剧生成、数字人口播、无限画布等常用接口
"""

import requests
import time
import json
from typing import Optional, Dict, Any, List


class AgnesAPIClient:
    """Agnes AI Studio API 客户端"""

    def __init__(self, base_url: str = "http://127.0.0.1:5000", timeout: int = 120):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _post(self, endpoint: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """发送 POST 请求"""
        resp = requests.post(f"{self.base_url}{endpoint}", json=data, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def _get(self, endpoint: str) -> Dict[str, Any]:
        """发送 GET 请求"""
        resp = requests.get(f"{self.base_url}{endpoint}", timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    # ==================== 图片生成 ====================

    def generate_image(self, prompt: str, model: str = "agnes-image-2.1-flash",
                       size: str = "1024x1024", negative_prompt: str = "",
                       reference_image: Optional[str] = None) -> Dict[str, Any]:
        """
        文生图 / 图生图

        Args:
            prompt: 图片描述提示词
            model: 图片模型 (agnes-image-2.1-flash / doubao-seedream-3-0 / minimax-image-01 / qwen-image-plus)
            size: 图片尺寸 (1024x1024 / 768x1024 / 1024x768 等)
            negative_prompt: 负面提示词
            reference_image: 参考图路径（图生图时使用）

        Returns:
            {"success": true, "image_url": "...", "local_file": "..."}
        """
        data = {
            "prompt": prompt,
            "model": model,
            "size": size,
            "negative_prompt": negative_prompt
        }
        if reference_image:
            data["reference_image"] = reference_image
        return self._post("/api/image/generate", data)

    # ==================== 视频生成 ====================

    def generate_video(self, prompt: str, model: str = "agnes-video-2.5-flash",
                       duration: int = 5, reference_image: Optional[str] = None) -> Dict[str, Any]:
        """
        文生视频 / 图生视频（异步，返回 task_id）

        Args:
            prompt: 视频描述提示词
            model: 视频模型 (agnes-video-2.5-flash / doubao-seaweed-t2v / MiniMax-H3 / minimax-video-01)
            duration: 视频时长（秒）
            reference_image: 参考图路径（图生视频时使用）

        Returns:
            {"success": true, "task_id": "..."}
        """
        data = {
            "prompt": prompt,
            "model": model,
            "duration": duration
        }
        if reference_image:
            data["reference_image"] = reference_image
        return self._post("/api/video/generate", data)

    def get_video_status(self, task_id: str) -> Dict[str, Any]:
        """查询视频生成任务状态"""
        return self._get(f"/api/video/status/{task_id}")

    def wait_for_video(self, task_id: str, max_wait: int = 600, interval: int = 5) -> Dict[str, Any]:
        """等待视频生成完成"""
        start = time.time()
        while time.time() - start < max_wait:
            status = self.get_video_status(task_id)
            if status.get("status") in ("completed", "failed", "stopped"):
                return status
            time.sleep(interval)
        return {"status": "timeout", "task_id": task_id}

    # ==================== 短剧生成 ====================

    def start_drama(self, prompt: str, novel_type: str = "short",
                    negative_prompt: str = "", shot_duration: int = 5,
                    text_model: str = "agnes-2.5-flash",
                    image_model: str = "agnes-image-2.1-flash",
                    video_model: str = "agnes-video-2.5-flash",
                    character_style: str = "anime") -> Dict[str, Any]:
        """
        启动短剧生成（6步流水线：故事→小说→剧本→分镜→三视图→视频）

        Args:
            prompt: 短剧描述
            novel_type: 小说类型 (mini=小小说 / short=短篇小说 / medium=中篇小说)
            negative_prompt: 负面提示词（用于生图和生视频）
            shot_duration: 每个分镜时长（秒）
            text_model: 文本模型
            image_model: 图片模型
            video_model: 视频模型
            character_style: 角色风格 (anime / realistic / 3d / custom)

        Returns:
            {"success": true, "drama_id": "...", "status": "pending"}
        """
        data = {
            "prompt": prompt,
            "novel_type": novel_type,
            "negative_prompt": negative_prompt,
            "shot_duration": shot_duration,
            "text_model": text_model,
            "image_model": image_model,
            "video_model": video_model,
            "character_style": character_style
        }
        return self._post("/api/drama/start", data)

    def get_drama_status(self, drama_id: str) -> Dict[str, Any]:
        """查询短剧任务状态"""
        return self._get(f"/api/drama/status/{drama_id}")

    def confirm_story(self, drama_id: str, edited_story: str = "") -> Dict[str, Any]:
        """确认/编辑故事梗概，继续生成小说"""
        return self._post("/api/drama/story/confirm", {
            "drama_id": drama_id,
            "edited_story": edited_story
        })

    def confirm_novel(self, drama_id: str, edited_novel: str = "") -> Dict[str, Any]:
        """确认/编辑小说，继续生成剧本"""
        return self._post("/api/drama/novel/confirm", {
            "drama_id": drama_id,
            "novel": edited_novel
        })

    def save_drama_local(self, drama_id: str) -> Dict[str, Any]:
        """将故事/小说/剧本/分镜保存到本地 txt 文件"""
        return self._post("/api/drama/save-local", {"drama_id": drama_id})

    def reextract_assets(self, drama_id: str) -> Dict[str, Any]:
        """重新提取素材并生成三视图"""
        return self._post("/api/drama/reextract-assets", {"drama_id": drama_id})

    def update_video_refs(self, drama_id: str) -> Dict[str, Any]:
        """更新分镜视频的参考图和提示词"""
        return self._post("/api/drama/update-video-refs", {"drama_id": drama_id})

    # ==================== 数字人口播 ====================

    def generate_anchor(self, script: str, mode: str = "A",
                        voice: str = "zh-CN-XiaoxiaoNeural",
                        use_tts: bool = True,
                        avatar_file: str = "", video_prompt: str = "",
                        min_duration: int = 5,
                        text_model: str = "agnes-2.5-flash",
                        image_model: str = "agnes-image-2.1-flash",
                        video_model: str = "agnes-video-2.5-flash") -> Dict[str, Any]:
        """
        生成数字人口播视频

        Args:
            script: 口播文稿内容
            mode: 画面模式 (A=静态形象图 / B=视频素材 / C=AI生成画面)
            voice: TTS 音色 (use_tts=True 时有效)
            use_tts: 是否使用 TTS 配音 (False=视频模型自带语音，对口型更自然)
            avatar_file: 形象图片/视频文件名 (mode=A/B 时必填)
            video_prompt: 画面风格提示词 (mode=C 时必填)
            min_duration: 每段最小时长（秒）
            text_model: 文本模型（文稿分段）
            image_model: 图片模型（C模式）
            video_model: 视频模型（C模式）

        Returns:
            {"success": true, "task_id": "..."}
        """
        data = {
            "script": script,
            "mode": mode,
            "voice": voice,
            "use_tts": use_tts,
            "avatar_file": avatar_file,
            "video_prompt": video_prompt,
            "min_duration": min_duration,
            "text_model": text_model,
            "image_model": image_model,
            "video_model": video_model
        }
        return self._post("/api/anchor/generate", data)

    def get_anchor_status(self, task_id: str) -> Dict[str, Any]:
        """查询数字人口播任务状态"""
        return self._get(f"/api/anchor/status/{task_id}")

    # ==================== 无限画布 ====================

    def list_canvases(self) -> Dict[str, Any]:
        """列出所有画布"""
        return self._get("/api/canvas/list")

    def save_canvas(self, canvas_id: str, nodes: List[Dict], edges: List[Dict]) -> Dict[str, Any]:
        """保存画布"""
        return self._post("/api/canvas/save", {
            "canvas_id": canvas_id,
            "nodes": nodes,
            "edges": edges
        })

    def load_canvas(self, canvas_id: str) -> Dict[str, Any]:
        """加载画布"""
        return self._get(f"/api/canvas/load/{canvas_id}")

    def delete_canvas(self, canvas_id: str) -> Dict[str, Any]:
        """删除画布"""
        return self._post("/api/canvas/delete", {"canvas_id": canvas_id})

    # ==================== 配置 ====================

    def get_config(self) -> Dict[str, Any]:
        """获取当前配置"""
        return self._get("/api/config")

    def health_check(self) -> bool:
        """健康检查，确认应用是否正常运行"""
        try:
            resp = requests.get(f"{self.base_url}/", timeout=5)
            return resp.status_code == 200
        except Exception:
            return False


# ==================== 便捷函数 ====================

def quick_image(prompt: str, model: str = "doubao-seedream-3-0", **kwargs) -> Dict[str, Any]:
    """快速生成图片（便捷函数）"""
    client = AgnesAPIClient()
    return client.generate_image(prompt, model=model, **kwargs)


def quick_video(prompt: str, model: str = "doubao-seaweed-t2v", wait: bool = True, **kwargs) -> Dict[str, Any]:
    """快速生成视频（可选等待完成）"""
    client = AgnesAPIClient()
    result = client.generate_video(prompt, model=model, **kwargs)
    if wait and result.get("success"):
        result = client.wait_for_video(result["task_id"])
    return result


if __name__ == "__main__":
    # 示例：健康检查
    client = AgnesAPIClient()
    if client.health_check():
        print("Agnes AI Studio 运行正常")
        # 示例：生成一张图片
        # result = client.generate_image("一只可爱的橘猫", model="doubao-seedream-3-0")
        # print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print("Agnes AI Studio 未运行，请先执行 python app.py")
