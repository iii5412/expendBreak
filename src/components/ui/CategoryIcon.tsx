import React from 'react';
import {
  AlertTriangle,
  Briefcase,
  Car,
  Coins,
  CreditCard,
  Gift,
  GraduationCap,
  HeartHandshake,
  Home,
  LucideIcon,
  MoreHorizontal,
  Palmtree,
  RotateCcw,
  ShoppingBag,
  Smartphone,
  Stethoscope,
  Tag,
  Tv,
  TrendingUp,
  Users,
  Utensils,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react';

/**
 * `Category.icon` holds a lucide icon *name*, not a glyph, so rendering it
 * directly prints "GraduationCap" instead of the icon. Only the names the seed
 * categories and the category editor can produce are mapped: importing lucide's
 * full `icons` record would pull every icon into the bundle.
 */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  AlertTriangle,
  Briefcase,
  Car,
  Coins,
  CreditCard,
  Gift,
  GraduationCap,
  HeartHandshake,
  Home,
  MoreHorizontal,
  Palmtree,
  RotateCcw,
  ShoppingBag,
  Smartphone,
  Stethoscope,
  Tag,
  Tv,
  TrendingUp,
  Users,
  Utensils,
  UtensilsCrossed,
  Wallet,
};

export function resolveCategoryIcon(iconName?: string | null): LucideIcon | null {
  if (!iconName) return null;
  return CATEGORY_ICONS[iconName] ?? null;
}

interface CategoryIconProps {
  /** Lucide icon name stored on the category. */
  name?: string | null;
  className?: string;
  /** Rendered when the name is missing or unknown, e.g. an emoji. */
  fallback?: React.ReactNode;
}

export const CategoryIcon: React.FC<CategoryIconProps> = ({ name, className = 'w-5 h-5', fallback = null }) => {
  const Icon = resolveCategoryIcon(name);
  if (!Icon) return <>{fallback}</>;
  return <Icon className={className} aria-hidden />;
};
