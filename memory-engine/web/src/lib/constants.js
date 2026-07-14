import {
  BookOpen,
  MessageCircle,
  Compass,
  Calendar,
  Users,
  Map,
  BarChart3,
  Wrench,
} from 'lucide-react'

export const NAV_ITEMS = [
  { to: '/', icon: BookOpen, label: 'Today' },
  { to: '/ask', icon: MessageCircle, label: 'Ask' },
  { to: '/explore', icon: Compass, label: 'Explore' },
  { to: '/timeline', icon: Calendar, label: 'Timeline' },
  { to: '/people', icon: Users, label: 'People' },
  { to: '/journeys', icon: Map, label: 'Journeys' },
  { to: '/insights', icon: BarChart3, label: 'Insights' },
  { to: '/studio', icon: Wrench, label: 'Studio' },
]

export const SCENE_TAGS = [
  'selfie',
  'group photo',
  'food',
  'document/screenshot',
  'landscape',
  'beach',
  'indoor',
  'pet',
]

export const WARDROBE_FILTERS = [
  { label: 'Formal', query: 'formal outfit' },
  { label: 'Casual', query: 'casual outfit' },
  { label: 'Kurta', query: 'kurta outfit' },
  { label: 'Blue', query: 'blue clothing' },
  { label: 'Red', query: 'red clothing' },
  { label: 'White Shirt', query: 'white shirt' },
]

export const CHAT_PROMPTS = {
  Recap: [
    'What was I doing in July 2023?',
    'Summarize my 2024 memories',
    'What trips did I take last year?',
  ],
  Find: [
    'food in 2025',
    'selfie photos',
    'landscape photos',
    'wardrobe outfit',
  ],
  People: [
    'selfie with Maa',
    'group photos with family',
    'photos with friends',
  ],
  Places: [
    'beach photos',
    'home photos',
    'travel memories',
  ],
}
