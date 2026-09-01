import { Text, View } from "@tarojs/components";

type BrandHeaderProps = { eyebrow?: string; title: string; detail?: string };

export default function BrandHeader({ eyebrow, title, detail }: BrandHeaderProps) {
  return <View className="brand-header">
    <View className="brand-mark" aria-label="Couju">C</View>
    <View className="brand-copy">
      {eyebrow ? <Text className="brand-eyebrow">{eyebrow}</Text> : null}
      <Text className="brand-title">{title}</Text>
      {detail ? <Text className="brand-detail">{detail}</Text> : null}
    </View>
  </View>;
}
