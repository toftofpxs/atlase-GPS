import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  children: ReactNode
  active?: boolean
}

export function IconButton({
  label,
  children,
  active = false,
  className = '',
  ...props
}: IconButtonProps) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`icon-button ${active ? 'icon-button-active' : ''} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
