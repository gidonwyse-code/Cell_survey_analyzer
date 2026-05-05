import MapView from './components/Map/MapView'
import Sidebar from './components/Sidebar/Sidebar'
import Legend from './components/Legend'
import PieChartModal from './components/PieChartModal'

export default function App() {
  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <div className="relative flex-1 h-full">
        <MapView />
        <Legend />
      </div>
      <PieChartModal />
    </div>
  )
}
