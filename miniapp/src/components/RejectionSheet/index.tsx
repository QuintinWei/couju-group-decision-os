import { Button, Text, View } from "@tarojs/components";

import { rejectionReasonOptions } from "../../domain/swipe.ts";
import type { Candidate, RejectionReason } from "../../types/api.ts";
import "./index.scss";

type RejectionSheetProps = {
  candidate: Candidate;
  onReason: (reason: RejectionReason) => void;
  onClose: () => void;
};

export default function RejectionSheet({ candidate, onReason, onClose }: RejectionSheetProps) {
  return <View className="rejection-sheet-mask">
    <View className="rejection-sheet">
      <Text className="rejection-sheet-title">哪里不合适？</Text>
      <Text className="rejection-sheet-detail">可选，不填写也会保留“不喜欢”。</Text>
      <View className="rejection-options">
        {rejectionReasonOptions(candidate.kind).map((option) => <Button className="rejection-option" key={option.key} onClick={() => onReason(option.reason)}>{option.label}</Button>)}
      </View>
      <Button className="rejection-skip" onClick={onClose}>暂不填写</Button>
    </View>
  </View>;
}
