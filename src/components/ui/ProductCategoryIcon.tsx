import { Icon, type IconName } from '@/components/ui/Icon'

export function categoryTone(category: string): 'drinks' | 'food' | 'snacks' | 'other' {
  const label = category.trim().toLowerCase()
  if (/^(drinks?|beverages?|음료)$/.test(label)) return 'drinks'
  if (/^(food|meals?|식품|음식)$/.test(label)) return 'food'
  if (/^(snacks?|간식)$/.test(label)) return 'snacks'
  return 'other'
}

const categoryIcons: Record<ReturnType<typeof categoryTone>, IconName> = {
  drinks: 'cup', food: 'meal', snacks: 'snack', other: 'bag',
}

export function ProductCategoryIcon({ category, className, size = 24 }: {
  category: string; className?: string; size?: number
}) {
  return <Icon name={categoryIcons[categoryTone(category)]} size={size} className={className} />
}
