import { Button, Image, Text, View } from "@tarojs/components";

import { candidateDisplayFacts, candidateImageUrl } from "../../domain/swipe.ts";
import type { Candidate, Choice } from "../../types/api.ts";
import "./index.scss";

type CandidateCardProps = {
  candidate: Candidate;
  current: number;
  total: number;
  disabled?: boolean;
  onChoose: (choice: Choice) => void;
};

export default function CandidateCard({ candidate, current, total, disabled = false, onChoose }: CandidateCardProps) {
  const [location, price, commute] = candidateDisplayFacts(candidate);
  const image = candidateImageUrl(candidate.image, process.env.TARO_APP_API_BASE);

  return <View className="candidate-card">
    <Text className="candidate-progress">{current} / {total}</Text>
    <Image className="candidate-image" src={image} mode="aspectFill" />
    <View className="candidate-copy">
      <Text className="candidate-type">{candidate.type}</Text>
      <Text className="candidate-name">{candidate.name}</Text>
      <Text className="candidate-meta">{location}</Text>
      <View className="candidate-facts">
        <Text>{price}</Text>
        <Text>{commute}</Text>
      </View>
    </View>
    <View className="candidate-actions">
      <Button className="candidate-choice candidate-choice-no" disabled={disabled} onClick={() => onChoose("no")}>不喜欢</Button>
      <Button className="candidate-choice candidate-choice-okay" disabled={disabled} onClick={() => onChoose("okay")}>一般</Button>
      <Button className="candidate-choice candidate-choice-like" disabled={disabled} onClick={() => onChoose("like")}>喜欢</Button>
    </View>
  </View>;
}
