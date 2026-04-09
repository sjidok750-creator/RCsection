import React, { useState } from 'react'
import type { ModuleId, DesignCode } from './types'
import { useResponsive } from './hooks/useResponsive'
import Sidebar from './components/layout/Sidebar'
import Header from './components/layout/Header'
import MobileNav from './components/layout/MobileNav'
import SimpleBeamPanel from './components/modules/SimpleBeamPanel'
import DeepBeamPanel from './components/modules/DeepBeamPanel'
import SlabPanel from './components/modules/SlabPanel'
import ColumnPanel from './components/modules/ColumnPanel'
import WallPanel from './components/modules/WallPanel'
import AbutmentPanel from './components/modules/AbutmentPanel'
import FoundationPanel from './components/modules/FoundationPanel'

// 각 패널을 항상 마운트하고 display로 show/hide → 상태 유지
function ModulePanel({ id }: { id: ModuleId }) {
  const show = (mid: ModuleId) =>
    ({ display: id === mid ? 'flex' : 'none', flex: 1, overflow: 'hidden' } as React.CSSProperties)
  return (
    <>
      <div style={show('simple-beam')}><SimpleBeamPanel /></div>
      <div style={show('deep-beam')}><DeepBeamPanel /></div>
      <div style={show('slab-one-way')}><SlabPanel moduleId="slab-one-way" /></div>
      <div style={show('slab-two-way')}><SlabPanel moduleId="slab-two-way" /></div>
      <div style={show('rc-column')}><ColumnPanel /></div>
      <div style={show('rc-wall')}><WallPanel /></div>
      <div style={show('abutment')}><AbutmentPanel /></div>
      <div style={show('foundation')}><FoundationPanel /></div>
    </>
  )
}

export default function App() {
  const [activeModule, setActiveModule] = useState<ModuleId>('simple-beam')
  const [designCode, setDesignCode]     = useState<DesignCode>('KDS')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { isDesktop, isCompact } = useResponsive()

  return (
    <div style={{ display: 'flex', justifyContent: 'center', height: '100dvh', width: '100%', overflow: 'hidden', background: 'var(--bg-outer)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', maxWidth: 'var(--app-max-w)', background: 'var(--bg)', boxShadow: 'var(--app-shadow)' }}>
        <Header
          activeModule={activeModule}
          designCode={designCode}
          onToggleCode={() => setDesignCode(c => c === 'KDS' ? 'ACI' : 'KDS')}
          showMenuBtn={isCompact}
          onMenuOpen={() => setMobileNavOpen(true)}
        />
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {isDesktop && <Sidebar active={activeModule} onSelect={setActiveModule}/>}
          {isCompact && mobileNavOpen && (
            <MobileNav active={activeModule} onSelect={setActiveModule} onClose={() => setMobileNavOpen(false)}/>
          )}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }} className="fade-in">
            <ModulePanel id={activeModule}/>
          </div>
        </div>
      </div>
    </div>
  )
}
