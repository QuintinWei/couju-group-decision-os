import { Button } from "@tarojs/components";
import type { PropsWithChildren } from "react";

type PrimaryButtonProps = PropsWithChildren<{
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  className?: string;
}>;

export default function PrimaryButton({ children, disabled, loading, onClick, className = "" }: PrimaryButtonProps) {
  return <Button className={`primary-button ${className}`} disabled={disabled || loading} loading={loading} onClick={onClick}>{children}</Button>;
}
