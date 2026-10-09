import {
  Activity,
  Box,
  Briefcase,
  Building,
  Calendar,
  CheckSquare,
  CircleDollarSign,
  ClipboardList,
  FileText,
  Handshake,
  Headphones,
  Home,
  Landmark,
  LifeBuoy,
  MapPin,
  Megaphone,
  Package,
  Phone,
  Receipt,
  ShoppingCart,
  Star,
  Target,
  Ticket,
  Truck,
  UserRound,
  UserRoundSearch,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

/**
 * The icons a module may choose from.
 *
 * A module's icon is metadata — `modules.icon` holds a name, and the sidebar
 * resolves it at render time. The previous implementation did that by importing
 * lucide's whole `icons` map, which pulled roughly 1,500 icon components into
 * the main bundle and accounted for most of its 334 KB gzipped weight against
 * the plan's 250 KB ceiling (Plan Section 14).
 *
 * A named set keeps the behaviour fully metadata-driven while bounding the
 * bundle: the builder offers exactly these, the sidebar resolves exactly these,
 * and anything unrecognised falls back to a generic box. Adding one is a line
 * here, which is the same cost as adding a field type to the registry.
 */
export const MODULE_ICONS: Record<string, LucideIcon> = {
  Activity,
  Box,
  Briefcase,
  Building,
  Calendar,
  CheckSquare,
  CircleDollarSign,
  ClipboardList,
  FileText,
  Handshake,
  Headphones,
  Home,
  Landmark,
  LifeBuoy,
  MapPin,
  Megaphone,
  Package,
  Phone,
  Receipt,
  ShoppingCart,
  Star,
  Target,
  Ticket,
  Truck,
  UserRound,
  UserRoundSearch,
  Users,
  Wrench,
};

/** Kebab-case aliases, so a seeded `user-round-search` resolves too. */
function toPascalCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

export function resolveModuleIcon(iconName: string | null | undefined): LucideIcon {
  if (!iconName) return Box;
  return MODULE_ICONS[iconName] ?? MODULE_ICONS[toPascalCase(iconName)] ?? Box;
}

export const MODULE_ICON_OPTIONS = Object.keys(MODULE_ICONS).map((name) => ({
  name,
  icon: MODULE_ICONS[name],
}));
