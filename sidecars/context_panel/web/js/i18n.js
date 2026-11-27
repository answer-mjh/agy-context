(function (global) {
  const AGY = (global.AGY_CTX = global.AGY_CTX || {});

  const DICT = {
    zh: {
      brand: 'Antigravity Context',
      navInsights: '上下文洞察',
      navContext: 'Context 面板',
      navFleet: '编队',
      commonLoading: '加载中…',
      refresh: '刷新',
      settings: '偏好设置',
      langToggle: 'EN',
      // Ranges
      rangeToday: '今天',
      rangeWeeklyQuota: '周限额',
      range7d: '近 7 天',
      range30d: '近 30 天',
      rangeAll: '全部',
      weeklyQuotaAllPools: '全部额度池',
      weeklyQuotaRemaining: '剩余',
      weeklyQuotaResetIn: '后重置',
      weeklyQuotaResetsAt: '重置时间',
      weeklyQuotaOfficialSource: '数据来自 Antigravity 官方周限额重置周期',
      weeklyQuotaFallbackTag: '自然周',
      weeklyQuotaFallbackHint: '未获取到官方周限额重置时间，已按自然周（周一至周日）统计',
      weeklyQuotaUntouched: '本周期尚未消耗',
      allWorkspaces: '全部工作区',
      searchSessions: '搜索会话标题 / 工作区 / 模型…',
      clearFilters: '清除筛选',
      sortRecent: '最近活跃',
      sortTokens: '计费 Token',
      sortContext: '上下文大小',
      sortCost: '预估成本',
      // KPIs
      kpiAllSessions: '全部会话',
      kpiBillable: 'Token 消耗',
      kpiCost: '预估费用',
      kpiCache: '缓存命中',
      kpiSessions: '活跃会话 / 轮次',
      kpiTools: '工具调用',
      kpiDuration: '活跃时长',
      dshSubTotal: '总计',
      dshSubTurns: '轮次',
      dshSubReqs: '模型调用',
      dshSubSessions: '含会话',
      dshSubToolExec: '工具执行',
      // Insights sections
      chart7Title: '近 7 天用量',
      chart7Sub: '仅含支持计价映射的模型',
      heatmapTitle: '活跃度',
      heatmapSub: '按日期筛选',
      hmModeSessions: '会话',
      hmModeTokens: 'Token 消耗',
      hmLess: '少',
      hmMore: '多',
      rankProjects: '项目分布',
      rankSkills: '技能加载',
      rankTools: '工具调用',
      rankCommands: '命令执行',
      compDonutTitle: 'Token 统计',
      timingStatsTitle: '耗时统计',
      sessionCumulative: '会话累计',
      outputSpeed: '输出速度',
      latestSpeedLabel: '最近一次请求',
      avgSpeedLabel: '会话加权平均',
      speedAvgShort: '均',
      speedTooltipStreaming: '纯流式生成速度（不含首字等待 TTFT）',
      speedTooltipEstimated: '估算端到端输出速度（语言服务不可用时的回退值）',
      avgTtftLabel: '平均首字延迟 (TTFT)',
      endToEndSpeedLabel: '端到端速度 (含 TTFT)',
      totalUsage: '总用量',
      activeDuration: '活跃时长',
      // Fleet
      fleetSummary: '编队摘要',
      fleetFamily: 'Agent 家族',
      fleetAgentCount: 'Agent 数',
      fleetChildCount: '个子 Agent',
      fleetRunning: '运行中',
      fleetWorkItems: '工作项',
      fleetMessages: '消息',
      fleetFamilyTokens: '家族计费',
      fleetAgentNetwork: 'Agent 网络',
      fleetAgentNetworkHint: '当前 Agent、父级与所有子 Agent；悬停点亮链路，点击查看详情',
      fleetNoFamilyHint: '当前会话没有子 Agent。启动一个子 Agent 后，这里会显示家族网络与协作时间线。',
      fleetRootAgent: '主 Agent',
      fleetChildAgent: '子 Agent',
      fleetCurrentAgent: '当前',
      fleetIdle: '空闲',
      fleetRunningStatus: '运行中',
      fleetContextUsed: '上下文已用',
      fleetSteps: '步数',
      fleetRequests: '请求',
      fleetActive: '活跃',
      fleetOpenContext: '打开上下文',
      fleetBilled: '计费',
      fleetStarted: '开始',
      fleetFinished: '完成',
      fleetTaskBrief: '任务简报',
      fleetTaskReport: '最终回报',
      fleetCollaboration: '跨 Agent 协作',
      fleetCollabHint: '把消息、任务标记与委派记录放到同一条时间线上',
      fleetEarliest: '最早',
      fleetLatest: '最新',
      fleetSearchLanes: '搜索 Agent…',
      fleetTasks: '协作任务',
      fleetTasksHint: '团队任务与子 Agent 委派',
      fleetTaskInProgress: '进行中',
      fleetTaskCompleted: '已完成',
      fleetNoTasks: '当前筛选条件下没有协作任务。',
      fleetExpand: '展开',
      fleetCollapse: '收起',
      fleetEvents: '事件检查',
      fleetEventsHint: '谁对谁说了什么',
      fleetEventAll: '全部',
      fleetEventDelegate: '委派',
      fleetEventMessage: '消息',
      fleetEventComplete: '完成',
      fleetSearchEvents: '按类型或文本筛选…',
      fleetNoEvents: '当前筛选条件下没有事件。',
      fleetShowMore: '显示更多',
      prefFleetTab: '编队标签页',
      fleetShowTab: '显示',
      fleetHideTab: '隐藏',
      pluginSettings: '插件设置',
      pluginInfo: '插件信息',
      openPluginSettings: '打开插件设置',
      sessionsTitle: '会话列表',
      noSessions: '当前筛选条件下没有匹配的会话。',
      // Context Dashboard
      contextStats: '上下文统计',
      tokenStats: 'Token 统计',
      timingStats: '耗时统计',
      turns: '轮次',
      requests: '步数',
      skillsLoadedLabel: '技能加载',
      modelReplies: '模型回复',
      ctxEventsLabel: '上下文事件',
      ioSummary: '输入输出',
      modelBilling: '模型与计费',
      currentAgent: '当前 Agent',
      currentModel: '当前模型',
      noRecords: '暂无',
      otherTools: '其他',
      userInputs: '用户',
      userInputsLabel: '用户输入',
      toolCalls: '工具调用',
      estCost: '预估费用',
      cacheHit: '缓存命中',
      modelTime: '模型等待',
      thinkingTime: '模型思考',
      replyTime: '模型回复',
      toolArgTime: '工具参数',
      toolTime: '工具执行',
      overheadTime: '其他开销',
      activeTotal: '活跃时长',
      currentContext: '当前上下文',
      ctxUsedLabel: '上下文已用',
      windowLimit: '窗口上限',
      autocompactReserve: '自动压缩预留',
      outputReserve: '输出预留',
      actualBilled: '实测计费',
      estimatedBreakdown: '≈ 估算组成',
      // Categories
      catSystemBase: '系统提示词',
      catToolDefs: '工具定义',
      catUser: '用户消息',
      catInjected: '注入内容',
      catSkills: '技能注入',
      catAssistant: '模型回复',
      catThinking: '模型思考',
      catTools: '工具调用',
      catToolDefs: '工具定义',
      catToolResults: '工具结果',
      catMedia: '媒体附件',
      catOther: '其他',
      officialSnapshot: '官方快照',
      effectiveWindow: '有效上下文',
      nativeWindow: '原生窗口',
      // Timeline
      timelineTitle: '上下文时间线',
      granStep: '按请求 (Step)',
      granTurn: '按轮次 (Turn)',
      modeTotal: '累计 (Total)',
      modeDelta: '变化 (Delta)',
      modeOverview: '总览',
      stepBriefUser: 'User',
      stepBriefIn: 'In',
      stepBriefResp: 'Response',
      pinnedStep: '已固定步骤',
      latestStep: '当前最新',
      unpin: '回到最新',
      flagCompaction: '压缩',
      flagSkill: '技能',
      flagModel: '切模型',
      flagError: '错误',
      flagSlowest: '最慢',
      flagGrowth: '最大增长',
      // Browser & DNA
      browserTitle: '上下文浏览器',
      viewCategories: '分类视图',
      viewDna: 'DNA 模式',
      baselinePrevTurn: '对比上一轮',
      baselinePrevStep: '对比上一步',
      searchBrowser: '筛选当前步骤内容…',
      browserSort: '分类内排序',
      browserSortOrder: '原始顺序',
      browserSortSize: '按大小',
      browserSortCalls: '按调用',
      browserSortName: '按名称',
      browserSortStep: '按步骤',
      browserSortTip: '仅排序当前分类，不影响统计',
      filterThinking: 'Thinking',
      filterTools: 'Tools',
      filterAnswer: 'Answer',
      rawView: '原文',
      mdView: 'Markdown',
      linesUnit: '行',
      dnaRibbonHint: '按模型读取顺序（左旧 → 右新），下方倒序平铺展示',
      // Recent Calls Table
      callsTitle: '最近调用明细',
      callsFilterAll: '全部',
      callsFilterWarm: '热缓存',
      callsFilterCold: '冷启动',
      callsFilterIssue: '异常',
      callsCollapse: '收起',
      callsExpand: '展开',
      callsColTime: '时间',
      callsColModel: '实际模型',
      callsColInput: '输入',
      callsColDelta: '净增量 Δ',
      callsColOutput: '输出',
      callsColCache: '缓存命中率',
      callsColCost: '费用',
      callsColTtft: '首字耗时',
      callsColTotal: '总耗时',
      callsColSpeed: '速度',
      callsColStatus: '状态',
      callsRoleOrch: '编排',
      callsRoleExec: '执行',
      callsThinkWord: '思考',
      callsCacheWarm: '热缓存',
      callsCachePartial: '部分命中',
      callsCacheCold: '冷启动',
      callsSwitchCold: '切换冷启动',
      callsShortSample: '短样本',
      callsShortSampleTip: '短样本（原始估算 {speed} tok/s）',
      callsStatusOk: '成功',
      callsStatusRetry: '重试',
      callsStatusError: '失败',
      callsNoMatches: '当前筛选条件下没有调用记录。',
      callsPageSize: '每页',
      callsPrev: '上一页',
      callsNext: '下一页',
      // Events
      eventsTitle: '上下文事件',
      evAll: '全部',
      evInjection: '注入',
      evCompaction: '压缩',
      evSkill: '技能',
      evModel: '切模型',
      evError: '错误',
      noEvents: '本会话暂无记录到的上下文事件。',
      // Files
      filesTitle: '文件活动',
      filesScopeHint: '汇总至当前所选步骤',
      fAll: '全部',
      fRead: '读取',
      fWritten: '写入',
      fSearched: '搜索',
      fImages: '图片',
      searchFiles: '搜索文件路径…',
      noFiles: '当前步骤前没有文件读写或搜索记录。',
      jumpBrowser: '跳至浏览器',
      // Commands
      cmdsTitle: '命令执行',
      cmdPrograms: '程序分布',
      cmdNotable: '值得关注',
      cmdSlowest: '最慢命令',
      cmdFailed: '失败命令',
      cmdAll: '全部状态',
      cmdOk: '成功',
      cmdErr: '失败',
      searchCmds: '搜索命令或程序…',
      noCmds: '本会话没有命令执行记录。',
      // Settings
      settingsTitle: '偏好设置',
      prefLang: '界面语言',
      prefRange: '洞察默认时间范围',
      prefGran: '时间线默认粒度',
      prefMode: '时间线默认模式',
      prefBaseline: '浏览器对比基线',
      close: '关闭',
      loading: '正在加载会话数据…',
      noData: '尚未检测到 Antigravity 会话日志。',
      emptyNoHostConversation: '当前面板未收到宿主会话 ID，请在具体会话右侧打开 Context 面板。',
      emptyWaitingTranscript: '当前会话尚未产生对话记录，发送首条消息后将自动显示本会话消耗。',
      emptySelectSession: '请先从「上下文洞察」点击一个会话卡片，或在上方选择要查看的会话。',
      selectSessionPlaceholder: '选择会话…',
      backToCurrentSession: '回到当前会话',
      pricingHint: '基于参考单价估算（USD / 1M tokens）',
      copy: '复制',
      copied: '已复制',
    },
    en: {
      brand: 'Antigravity Context',
      navInsights: 'Insights',
      navContext: 'Context',
      navFleet: 'Fleet',
      commonLoading: 'Loading…',
      refresh: 'Refresh',
      settings: 'Preferences',
      langToggle: '中文',
      rangeToday: 'Today',
      rangeWeeklyQuota: 'Weekly Quota',
      range7d: '7 Days',
      range30d: '30 Days',
      rangeAll: 'All',
      weeklyQuotaAllPools: 'All Pools',
      weeklyQuotaRemaining: 'left',
      weeklyQuotaResetIn: 'until reset',
      weeklyQuotaResetsAt: 'Resets',
      weeklyQuotaOfficialSource: 'Synced with Antigravity weekly quota reset window',
      weeklyQuotaFallbackTag: 'Calendar Week',
      weeklyQuotaFallbackHint: 'Official weekly quota reset unavailable; using calendar week (Mon–Sun)',
      weeklyQuotaUntouched: 'Unused this cycle',
      allWorkspaces: 'All Workspaces',
      searchSessions: 'Search title / workspace / model…',
      clearFilters: 'Clear',
      sortRecent: 'Recent',
      sortTokens: 'Billable Tokens',
      sortContext: 'Context Size',
      sortCost: 'Est. Cost',
      kpiAllSessions: 'All Sessions',
      kpiBillable: 'Tokens Used',
      kpiCost: 'Est. Cost',
      kpiCache: 'Cache Hit',
      kpiSessions: 'Sessions / Turns',
      kpiTools: 'Tool Calls',
      kpiDuration: 'Active Time',
      dshSubTotal: 'Total',
      dshSubTurns: 'Turns',
      dshSubReqs: 'Model calls',
      dshSubSessions: 'Sessions',
      dshSubToolExec: 'Tool exec',
      chart7Title: 'Last 7 Days Usage',
      chart7Sub: 'Models with pricing only',
      heatmapTitle: 'Activity',
      heatmapSub: 'Filter by date',
      hmModeSessions: 'Sessions',
      hmModeTokens: 'Tokens',
      hmLess: 'Less',
      hmMore: 'More',
      rankProjects: 'Projects',
      rankSkills: 'Skills Loaded',
      rankTools: 'Tool Calls',
      rankCommands: 'Commands',
      compDonutTitle: 'Token Stats',
      timingStatsTitle: 'Timing Stats',
      sessionCumulative: 'Cumulative',
      outputSpeed: 'Output Speed',
      latestSpeedLabel: 'Latest request',
      avgSpeedLabel: 'Session avg',
      speedAvgShort: 'avg',
      speedTooltipStreaming: 'Pure streaming generation speed (excluding TTFT)',
      speedTooltipEstimated: 'Estimated end-to-end speed (fallback without language server)',
      avgTtftLabel: 'Avg TTFT',
      endToEndSpeedLabel: 'End-to-end (incl. TTFT)',
      totalUsage: 'Total Used',
      activeDuration: 'Active Time',
      fleetSummary: 'Fleet Summary',
      fleetFamily: 'Agent family',
      fleetAgentCount: 'Agents',
      fleetChildCount: 'subagents',
      fleetRunning: 'Running',
      fleetWorkItems: 'Work items',
      fleetMessages: 'Messages',
      fleetFamilyTokens: 'Family billed',
      fleetAgentNetwork: 'Agent Network',
      fleetAgentNetworkHint: 'Current agent, parents and every subagent; hover to trace a lineage, click for details',
      fleetNoFamilyHint: 'This session has no subagents yet. Once one starts, the family network and collaboration timeline will appear here.',
      fleetRootAgent: 'Root agent',
      fleetChildAgent: 'Subagent',
      fleetCurrentAgent: 'Current',
      fleetIdle: 'Idle',
      fleetRunningStatus: 'Running',
      fleetContextUsed: 'Context used',
      fleetSteps: 'Steps',
      fleetRequests: 'Requests',
      fleetActive: 'Active',
      fleetOpenContext: 'Open context',
      fleetBilled: 'Billed',
      fleetStarted: 'Started',
      fleetFinished: 'Finished',
      fleetTaskBrief: 'Task brief',
      fleetTaskReport: 'Final report',
      fleetCollaboration: 'Cross-Agent Collaboration',
      fleetCollabHint: 'Messages, task markers and delegations on one timeline',
      fleetEarliest: 'Earliest',
      fleetLatest: 'Latest',
      fleetSearchLanes: 'Search agents…',
      fleetTasks: 'Teamwork Tasks',
      fleetTasksHint: 'Team tasks and subagent delegations',
      fleetTaskInProgress: 'In progress',
      fleetTaskCompleted: 'Completed',
      fleetNoTasks: 'No teamwork tasks in this filter.',
      fleetExpand: 'Expand',
      fleetCollapse: 'Collapse',
      fleetEvents: 'Event Inspection',
      fleetEventsHint: 'Who said what to whom',
      fleetEventAll: 'All',
      fleetEventDelegate: 'Delegate',
      fleetEventMessage: 'Message',
      fleetEventComplete: 'Complete',
      fleetSearchEvents: 'Filter by type or text…',
      fleetNoEvents: 'No events in this filter.',
      fleetShowMore: 'Show more',
      prefFleetTab: 'Fleet tab',
      fleetShowTab: 'Show',
      fleetHideTab: 'Hide',
      pluginSettings: 'Settings',
      pluginInfo: 'Plugin Info',
      openPluginSettings: 'Open Settings',
      sessionsTitle: 'Sessions',
      noSessions: 'No matching sessions in the selected filter.',
      contextStats: 'Context Stats',
      tokenStats: 'Token Stats',
      timingStats: 'Timing Stats',
      turns: 'Turns',
      requests: 'Steps',
      skillsLoadedLabel: 'Skills',
      modelReplies: 'Replies',
      ctxEventsLabel: 'Context Events',
      ioSummary: 'I/O Summary',
      modelBilling: 'Model & Billing',
      currentAgent: 'Current Agent',
      currentModel: 'Current Model',
      noRecords: 'None',
      otherTools: 'Other',
      userInputs: 'User',
      userInputsLabel: 'User Inputs',
      toolCalls: 'Tool Calls',
      estCost: 'Est. Cost',
      cacheHit: 'Cache Hit',
      modelTime: 'Model Wait',
      thinkingTime: 'Thinking',
      replyTime: 'Model Reply',
      toolArgTime: 'Tool Args',
      toolTime: 'Tool Exec',
      overheadTime: 'Overhead',
      activeTotal: 'Active Time',
      currentContext: 'Current Context',
      ctxUsedLabel: 'Context Used',
      windowLimit: 'Window Limit',
      autocompactReserve: 'Autocompact Reserve',
      outputReserve: 'Output Reserve',
      actualBilled: 'Actual Billed',
      estimatedBreakdown: '≈ Est. Breakdown',
      catSystemBase: 'System Prompt',
      catToolDefs: 'Tool Defs',
      catUser: 'User Messages',
      catInjected: 'Injected',
      catSkills: 'Skill Injections',
      catAssistant: 'Model Replies',
      catThinking: 'Thinking',
      catTools: 'Tool Calls',
      catToolDefs: 'Tool Definitions',
      catToolResults: 'Tool Results',
      catMedia: 'Media',
      catOther: 'Other',
      officialSnapshot: 'Official snapshot',
      effectiveWindow: 'Effective Context',
      nativeWindow: 'Native Window',
      timelineTitle: 'Context Timeline',
      granStep: 'Step',
      granTurn: 'Turn',
      modeTotal: 'Total',
      modeDelta: 'Delta',
      modeOverview: 'Overview',
      stepBriefUser: 'User',
      stepBriefIn: 'In',
      stepBriefResp: 'Response',
      pinnedStep: 'Pinned Step',
      latestStep: 'Latest',
      unpin: 'Latest',
      flagCompaction: 'Compaction',
      flagSkill: 'Skill',
      flagModel: 'Model Switch',
      flagError: 'Error',
      flagSlowest: 'Slowest',
      flagGrowth: 'Max Growth',
      browserTitle: 'Context Browser',
      viewCategories: 'Categories',
      viewDna: 'DNA Mode',
      baselinePrevTurn: 'vs Prev Turn',
      baselinePrevStep: 'vs Prev Step',
      searchBrowser: 'Filter items in this step…',
      browserSort: 'Sort category',
      browserSortOrder: 'Original order',
      browserSortSize: 'By size',
      browserSortCalls: 'By calls',
      browserSortName: 'By name',
      browserSortStep: 'By step',
      browserSortTip: 'Sorts this category only; totals are unchanged',
      filterThinking: 'Thinking',
      filterTools: 'Tools',
      filterAnswer: 'Answer',
      rawView: 'Raw',
      mdView: 'Markdown',
      linesUnit: 'lines',
      dnaRibbonHint: 'Model reading order (oldest → newest); list below is reversed (newest first)',
      callsTitle: 'Recent Calls',
      callsFilterAll: 'All',
      callsFilterWarm: 'Warm',
      callsFilterCold: 'Cold',
      callsFilterIssue: 'Issues',
      callsCollapse: 'Collapse',
      callsExpand: 'Expand',
      callsColTime: 'Time',
      callsColModel: 'Actual Model',
      callsColInput: 'Input',
      callsColDelta: 'Net Δ',
      callsColOutput: 'Output',
      callsColCache: 'Cache Hit',
      callsColCost: 'Cost',
      callsColTtft: 'TTFT',
      callsColTotal: 'Total',
      callsColSpeed: 'Speed',
      callsColStatus: 'Status',
      callsRoleOrch: 'Plan',
      callsRoleExec: 'Exec',
      callsThinkWord: 'Think',
      callsCacheWarm: 'Warm',
      callsCachePartial: 'Partial',
      callsCacheCold: 'Cold',
      callsSwitchCold: 'Switch Cold',
      callsShortSample: 'Short',
      callsShortSampleTip: 'Short sample (raw est. {speed} tok/s)',
      callsStatusOk: 'OK',
      callsStatusRetry: 'Retry',
      callsStatusError: 'Error',
      callsNoMatches: 'No matching model calls.',
      callsPageSize: 'Per page',
      callsPrev: 'Prev',
      callsNext: 'Next',
      eventsTitle: 'Context Events',
      evAll: 'All',
      evInjection: 'Injection',
      evCompaction: 'Compaction',
      evSkill: 'Skill',
      evModel: 'Model Switch',
      evError: 'Error',
      noEvents: 'No context events recorded in this session.',
      filesTitle: 'File Activity',
      filesScopeHint: 'Aggregated up to selected step',
      fAll: 'All',
      fRead: 'Read',
      fWritten: 'Written',
      fSearched: 'Searched',
      fImages: 'Images',
      searchFiles: 'Filter file path…',
      noFiles: 'No file operations up to this step.',
      jumpBrowser: 'View in Browser',
      cmdsTitle: 'Command Executions',
      cmdPrograms: 'Programs',
      cmdNotable: 'Notable',
      cmdSlowest: 'Slowest',
      cmdFailed: 'Failed',
      cmdAll: 'All',
      cmdOk: 'OK',
      cmdErr: 'Failed',
      searchCmds: 'Filter commands or programs…',
      noCmds: 'No command executions in this session.',
      settingsTitle: 'Preferences',
      prefLang: 'Language',
      prefRange: 'Default Insights Range',
      prefGran: 'Default Timeline Granularity',
      prefMode: 'Default Timeline Mode',
      prefBaseline: 'Browser Diff Baseline',
      close: 'Close',
      loading: 'Loading context telemetry…',
      noData: 'No Antigravity session transcripts found yet.',
      emptyNoHostConversation: 'No host conversation ID was provided to this pane. Open Context inside a specific conversation.',
      emptyWaitingTranscript: 'This conversation has no transcript yet. Send a message to see its live context usage.',
      emptySelectSession: 'Select a session card from Insights or choose a conversation from the selector above.',
      selectSessionPlaceholder: 'Select session…',
      backToCurrentSession: 'Back to current session',
      pricingHint: 'Estimated from reference rates (USD / 1M tokens)',
      copy: 'Copy',
      copied: 'Copied',
    },
  };

  let currentLang = 'zh';

  function setLang(lang) {
    currentLang = lang === 'en' ? 'en' : 'zh';
  }

  function getLang() {
    return currentLang;
  }

  function t(key) {
    return (DICT[currentLang] && DICT[currentLang][key]) || DICT.en[key] || key;
  }

  function fmtTokens(n) {
    const num = Number(n) || 0;
    const abs = Math.abs(num);
    const sign = num < 0 ? '-' : '';
    if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1)}B`;
    if (abs >= 10_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 10_000) return `${sign}${(abs / 1_000).toFixed(1)}k`;
    if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}k`;
    return `${sign}${Math.round(abs)}`;
  }

  function fmtCompactCount(n) {
    const num = Number(n) || 0;
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
    return String(Math.round(num));
  }

  function fmtSignedTokens(n) {
    const num = Number(n) || 0;
    if (num === 0) return '0';
    return `${num > 0 ? '+' : ''}${fmtTokens(num)}`;
  }

  function fmtCost(usd) {
    const v = Number(usd) || 0;
    if (v === 0) return '$0.00';
    if (v < 0.01) return `$${v.toFixed(4)}`;
    if (v < 1) return `$${v.toFixed(3)}`;
    return `$${v.toFixed(2)}`;
  }

  function fmtPct(ratio, digits = 1) {
    const v = Number(ratio) || 0;
    return `${(v * 100).toFixed(digits)}%`;
  }

  function fmtDuration(ms) {
    const v = Math.max(0, Number(ms) || 0);
    if (v < 1000) return `${Math.round(v)}ms`;
    const sec = v / 1000;
    if (sec < 60) return `${sec.toFixed(1)}s`;
    const min = Math.floor(sec / 60);
    const remSec = Math.round(sec % 60);
    if (min < 60) return remSec > 0 ? `${min}m${remSec}s` : `${min}m`;
    const hr = Math.floor(min / 60);
    return `${hr}h${min % 60}m`;
  }

  function fmtBytes(bytes) {
    const b = Number(bytes) || 0;
    if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${b} B`;
  }

  function fmtRelativeTime(ms) {
    if (!ms) return '';
    const diff = Date.now() - ms;
    const min = Math.floor(diff / 60_000);
    if (min < 1) return currentLang === 'zh' ? '刚刚' : 'just now';
    if (min < 60) return currentLang === 'zh' ? `${min} 分钟前` : `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return currentLang === 'zh' ? `${hr} 小时前` : `${hr}h ago`;
    const day = Math.floor(hr / 24);
    return currentLang === 'zh' ? `${day} 天前` : `${day}d ago`;
  }

  function fmtClock(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function escHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Lightweight safe Markdown renderer for Context Browser tool results & assistant answers. */
  function renderSimpleMarkdown(raw) {
    const text = String(raw || '');
    if (!text) return '';
    const escaped = escHtml(text);
    // Code blocks
    const blocks = [];
    let html = escaped.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const idx = blocks.length;
      blocks.push(`<pre><code>${code}</code></pre>`);
      return `__CODE_BLOCK_${idx}__`;
    });
    // Headings
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
    // Inline code, bold, italic
    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    // Bullet lines & line breaks
    html = html.replace(/^\s*[-*] (.+)$/gm, '<div>• $1</div>');
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/__CODE_BLOCK_(\d+)__/g, (_, i) => blocks[Number(i)] || '');
    return html;
  }

  AGY.i18n = {
    setLang,
    getLang,
    t,
    fmtTokens,
    fmtCompactCount,
    fmtSignedTokens,
    fmtCost,
    fmtPct,
    fmtDuration,
    fmtBytes,
    fmtRelativeTime,
    fmtClock,
    escHtml,
    renderSimpleMarkdown,
  };
})(window);
