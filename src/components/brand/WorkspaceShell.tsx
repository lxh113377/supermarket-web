import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { IS_CLOUD } from '../../cloudbase'
import { handleTablistKeyDown } from '../../utils/rovingTabs'
import BrandMark from './BrandMark'

export interface WorkspaceTab {
  key: string
  label: string
  icon: 'chart' | 'box' | 'receipt' | 'service' | 'star'
}

function WorkspaceIcon({ name }: { name: WorkspaceTab['icon'] }) {
  const paths: Record<WorkspaceTab['icon'], string> = {
    chart: 'M4 19V9m5 10V5m5 14v-7m5 7V3',
    box: 'm4 7 8-4 8 4v10l-8 4-8-4V7Zm0 0 8 4m0 0 8-4m-8 4v10',
    receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6',
    service: 'M8 5h8M9 3h6v4H9V3Zm-3 5h12v12H6V8Zm3 4h6m-6 4h4',
    star: 'm12 3 2.6 5.6 6 .7-4.4 4.1 1.2 6-5.4-3-5.4 3 1.2-6-4.4-4.1 6-.7L12 3Z',
  }
  return <svg className="workspace-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}

export default function WorkspaceShell({ tab, tabs, onTabChange, title, description, children }: {
  tab: string
  tabs: readonly WorkspaceTab[]
  onTabChange: (key: string) => void
  title: string
  description: string
  children: ReactNode
}) {
  const current = tabs.find(t => t.key === tab) ?? tabs[0]
  return (
    <div className="workspace-app">
      <aside className="workspace-rail">
        <div className="workspace-brand"><BrandMark inverse /><span className="workspace-edition">经营工作台</span></div>
        <div className="workspace-nav" role="tablist" aria-label="管理功能" aria-orientation="vertical"
          onKeyDown={e => handleTablistKeyDown(e, tabs.map(t => t.key), tab, onTabChange, v => document.getElementById(`admin-tab-${v}`)?.focus())}>
          <p className="workspace-nav-caption">经营管理</p>
          {tabs.map(t => <button key={t.key} role="tab" aria-selected={tab === t.key} aria-controls={`admin-panel-${t.key}`} id={`admin-tab-${t.key}`}
            tabIndex={tab === t.key ? 0 : -1} onClick={() => onTabChange(t.key)}
            className={`workspace-nav-item ${tab === t.key ? 'is-active' : ''}`}>
            <WorkspaceIcon name={t.icon} /><span>{t.label}</span>{tab === t.key && <span className="workspace-nav-arrow" aria-hidden="true">↗</span>}
          </button>)}
        </div>
        <div className="workspace-rail-footer">
          <a href="/admin/" target="_blank" rel="noopener noreferrer">打印经营后台 <span aria-hidden="true">↗</span></a>
          <Link to="/">返回顾客端 <span aria-hidden="true">↗</span></Link>
          <div className="workspace-environment"><i aria-hidden="true" /><span>{IS_CLOUD ? '云端服务已连接' : '本地演示模式'}</span></div>
        </div>
      </aside>
      <div className="workspace-body">
        <div className="workspace-topline"><span>超柿 / {current.label}</span><span className="workspace-online"><i aria-hidden="true" />{IS_CLOUD ? '云端模式' : '本地演示'}</span></div>
        <main role="main" id="main-content" tabIndex={-1} className="workspace-main">
          <header className="workspace-heading">
            <div><p className="eyebrow">SUPERMARKET OPERATIONS</p><h1>{title}</h1><p>{description}</p></div>
            <span className="workspace-date">日常工作，清楚一点。</span>
          </header>
          {children}
        </main>
      </div>
    </div>
  )
}
