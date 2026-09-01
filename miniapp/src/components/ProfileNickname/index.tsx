import { Button, Input, Text, View } from "@tarojs/components";
import { useState } from "react";

import { updateNickname } from "../../services/profile";
import { loadSession } from "../../store/session";
import "./index.scss";

export default function ProfileNickname() {
  const initialNickname = loadSession()?.user.nickname || "微信用户";
  const [nickname, setNickname] = useState(initialNickname);
  const [draft, setDraft] = useState(initialNickname);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const changed = Boolean(draft.trim()) && draft.trim() !== nickname;

  async function confirmNickname() {
    if (!changed || submitting) return;
    setSubmitting(true);
    setMessage("");
    try {
      const user = await updateNickname(draft);
      setNickname(user.nickname);
      setDraft(user.nickname);
      setMessage("昵称已更新");
    } catch (error) {
      setDraft(nickname);
      setMessage(error instanceof Error ? error.message : "昵称更新失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  function cancelNickname() {
    setDraft(nickname);
    setMessage("已保留当前昵称");
  }

  return <View className="profile-nickname">
    <View className="profile-nickname__heading">
      <Text className="profile-nickname__label">当前昵称</Text>
      <Text className="profile-nickname__current">{nickname}</Text>
    </View>
    <Text className="profile-nickname__hint">可选：点输入框使用微信建议昵称，确认前不会修改。</Text>
    <Input
      className="profile-nickname__input"
      type="nickname"
      value={draft}
      maxlength={18}
      placeholder="使用微信昵称（可选）"
      onInput={(event) => { setDraft(event.detail.value); setMessage(""); }}
    />
    <View className="profile-nickname__actions">
      <Button className="profile-nickname__cancel" disabled={!changed || submitting} onClick={cancelNickname}>取消</Button>
      <Button className="profile-nickname__confirm" disabled={!changed || submitting} loading={submitting} onClick={() => void confirmNickname()}>确认使用</Button>
    </View>
    {message ? <Text className="profile-nickname__message">{message}</Text> : null}
  </View>;
}
