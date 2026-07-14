import { Routes, Route } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import TodayPage from './pages/TodayPage'
import AskPage from './pages/AskPage'
import ExplorePage from './pages/ExplorePage'
import TimelinePage from './pages/TimelinePage'
import PeoplePage from './pages/PeoplePage'
import PersonDetailPage from './pages/PersonDetailPage'
import JourneysPage from './pages/JourneysPage'
import TripDetailPage from './pages/TripDetailPage'
import InsightsPage from './pages/InsightsPage'
import StudioPage from './pages/StudioPage'

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<TodayPage />} />
        <Route path="/ask" element={<AskPage />} />
        <Route path="/explore" element={<ExplorePage />} />
        <Route path="/timeline" element={<TimelinePage />} />
        <Route path="/timeline/:year" element={<TimelinePage />} />
        <Route path="/people" element={<PeoplePage />} />
        <Route path="/people/:id" element={<PersonDetailPage />} />
        <Route path="/journeys" element={<JourneysPage />} />
        <Route path="/journeys/:id" element={<TripDetailPage />} />
        <Route path="/insights" element={<InsightsPage />} />
        <Route path="/studio" element={<StudioPage />} />
      </Routes>
    </AppShell>
  )
}
