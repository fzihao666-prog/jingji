import { DatabaseSync } from 'node:sqlite';

export async function checkCoachDailyTodos({
  request,
  assert,
  databasePath,
  coachToken,
  adminToken,
  coachId,
  athletes,
}) {
  const project = 'ROWING';
  const path = `/api/coach/daily-todos?project=${project}`;
  const read = () => request(path, {}, coachToken);
  const allRows = (todos) => [...todos.missing, ...todos.attention, ...todos.incompleteTime];
  assert((await request(path)).status === 401, '每日待办必须要求登录');
  const athleteLogin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'athlete01', password: 'demo123' }),
  });
  assert(
    (await request(path, {}, athleteLogin.payload.token)).status === 403,
    '运动员不能读取教练每日待办'
  );
  for (const suffix of [
    '&date=2026-02-30',
    '&date=2000-01-01',
    '&date=2999-01-01',
    '&date=',
    '&athleteId=999',
    '&project=CANOE_SPRINT',
    '&date[]=2026-09-23',
  ]) {
    assert(
      (await request(path + suffix, {}, coachToken)).status === 400,
      `每日待办应拒绝非法查询 ${suffix}`
    );
  }
  assert(
    (await request('/api/coach/daily-todos?project=UNKNOWN', {}, coachToken)).status === 400,
    '每日待办应拒绝无效项目'
  );
  const initial = await read();
  assert(initial.status === 200, '教练每日待办未成功返回');
  const todos = initial.payload.todos;
  const scopedIds = athletes.filter((row) => row.project === project).map((row) => row.id);
  assert(todos.counts.total === scopedIds.length, '待办人数应等于教练权限范围');
  assert(
    allRows(todos).every((row) => scopedIds.includes(row.athleteId) && row.project === project),
    '待办不能泄漏权限外运动员'
  );
  assert(
    (await request(`${path}&date=${todos.date}`, {}, coachToken)).status === 200,
    '每日待办应接受服务端当前日期'
  );
  const target = todos.missing[0];
  const injuryTarget = todos.missing[1];
  assert(target && injuryTarget, '隔离测试数据库缺少待办样例运动员');
  const now = new Date();
  const startTime = new Date(now.getTime() + 8 * 3600000).toISOString().slice(11, 16);
  const save = await request(
    '/api/special-training/sessions',
    {
      method: 'POST',
      body: JSON.stringify({
        sessions: [
          {
            athleteId: target.athleteId,
            project,
            date: todos.date,
            startTime,
            type: '专项训练',
            content: '每日待办API回归',
            duration: 120,
            distance: 15,
            rpe: 5,
            heartRate: 140,
            maxHeartRate: 175,
            power: 200,
            strokeRate: 24,
          },
        ],
      }),
    },
    coachToken
  );
  assert(save.status === 201, '每日待办测试训练填报失败');
  const afterSave = (await read()).payload.todos;
  assert(
    !afterSave.missing.some((row) => row.athleteId === target.athleteId),
    '填报后必须移出未填报名单'
  );
  assert(
    afterSave.attention.some(
      (row) => row.athleteId === target.athleteId && row.highLoad && row.load24h === 600
    ),
    '正式训练应触发600AU关注'
  );

  const injuryInput = {
    bodyPart: '肩部',
    injuryName: '待办回归关注',
    side: 'left',
    status: 'observation',
    painScore: 3,
    onsetDate: todos.date,
  };
  const injuryPath = `/api/athletes/${injuryTarget.athleteId}/injuries`;
  assert(
    (await request(injuryPath, { method: 'POST', body: JSON.stringify(injuryInput) }, coachToken))
      .status === 201,
    '待办回归伤病写入失败'
  );
  const afterInjury = (await read()).payload.todos;
  assert(
    afterInjury.attention.some(
      (row) => row.athleteId === injuryTarget.athleteId && row.injury?.recent
    ),
    '近24小时新增伤病应触发关注'
  );
  assert(
    (
      await request(
        injuryPath,
        {
          method: 'POST',
          body: JSON.stringify({ ...injuryInput, status: 'healthy', painScore: 0 }),
        },
        coachToken
      )
    ).status === 201,
    '待办回归恢复写入失败'
  );
  assert(
    !(await read()).payload.todos.attention.some((row) => row.athleteId === injuryTarget.athleteId),
    '最新健康状态必须解除旧伤病关注'
  );

  // —— 复查提醒、自评休息、疼痛趋势与今日已跟进（mini-injury-followup-and-todo-loop） ——
  const restTarget = todos.missing[2];
  const reviewTarget = todos.missing[3];
  assert(restTarget && reviewTarget, '隔离测试数据库缺少复查与休息样例运动员');
  const beijingTomorrow = new Date(Date.now() + 8 * 3600000 + 86400000).toISOString().slice(0, 10);

  // 复查提醒：最近一条非健康伤病带明天复查日期 → reviewDue 且 dueIn=1
  const reviewPath = `/api/athletes/${reviewTarget.athleteId}/injuries`;
  assert(
    (
      await request(
        reviewPath,
        {
          method: 'POST',
          body: JSON.stringify({
            bodyPart: '膝部',
            injuryName: '复查提醒回归',
            side: 'right',
            status: 'rehab',
            painScore: 2,
            onsetDate: todos.date,
            reviewDate: beijingTomorrow,
          }),
        },
        coachToken
      )
    ).status === 201,
    '复查提醒伤病写入失败'
  );
  const withReview = (await read()).payload.todos;
  const reviewRow = withReview.reviewDue.find((row) => row.athleteId === reviewTarget.athleteId);
  assert(
    reviewRow && reviewRow.dueIn === 1 && reviewRow.reviewDate === beijingTomorrow,
    '明天复查的伤病应进入复查提醒分组'
  );
  assert(
    withReview.counts.reviewDue === withReview.reviewDue.length,
    '复查提醒计数必须与名单一致'
  );

  // 自评休息：教练代填 status=rest → attention 且 restRequested=true
  assert(
    (
      await request(
        `/api/athletes/${restTarget.athleteId}/wellness`,
        { method: 'POST', body: JSON.stringify({ fatigueIndex: 6, status: 'rest' }) },
        coachToken
      )
    ).status === 200,
    '教练代填休息日报失败'
  );
  const withRest = (await read()).payload.todos;
  assert(
    withRest.attention.some(
      (row) => row.athleteId === restTarget.athleteId && row.restRequested
    ),
    '自评需要休息应进入关注分组'
  );
  assert(
    withRest.attention.every((row) => typeof row.restRequested === 'boolean'),
    '关注分组必须携带 restRequested 字段'
  );

  // 疼痛趋势：正式伤病与疼痛反馈都参与按日聚合，权限与窗口校验
  const trend = await request(
    `/api/athletes/${injuryTarget.athleteId}/injuries/pain-trend?days=30`,
    {},
    coachToken
  );
  assert(trend.status === 200, '疼痛趋势应成功返回');
  assert(
    trend.payload.parts.some((part) => part.bodyPart === '肩部' && part.series.length >= 1),
    '疼痛趋势应包含肩部序列'
  );
  assert(
    trend.payload.startDate &&
      trend.payload.endDate &&
      trend.payload.parts.every((part) =>
        part.series.every((point) =>
          point.date >= trend.payload.startDate && point.date <= trend.payload.endDate
        )
      ),
    '疼痛趋势序列必须落在返回的窗口内'
  );
  assert(
    (await request(`/api/athletes/${injuryTarget.athleteId}/injuries/pain-trend?days=6`, {}, coachToken))
      .status === 400 &&
      (await request(`/api/athletes/${injuryTarget.athleteId}/injuries/pain-trend?days=91`, {}, coachToken))
        .status === 400,
    '疼痛趋势应拒绝越界天数'
  );
  // 运动员不能查看他人疼痛趋势：目标必须避开 athlete01 本人（样例库中本人也在待办名单里）。
  const me = await request('/api/me', {}, athleteLogin.payload.token);
  const ownAthleteId = Number(me.payload.user?.athleteId) || 0;
  const otherInjuryTarget =
    [todos.missing[1], todos.missing[0]].find(
      (row) => row && row.athleteId !== ownAthleteId
    ) || injuryTarget;
  assert(
    (
      await request(
        `/api/athletes/${otherInjuryTarget.athleteId}/injuries/pain-trend`,
        {},
        athleteLogin.payload.token
      )
    ).status === 403,
    '运动员不能查看他人疼痛趋势'
  );
  if (ownAthleteId) {
    assert(
      (
        await request(
          `/api/athletes/${ownAthleteId}/injuries/pain-trend`,
          {},
          athleteLogin.payload.token
        )
      ).status === 200,
      '运动员可以查看本人疼痛趋势'
    );
  }

  // 今日已跟进：标记幂等、响应携带、撤销恢复；角色与项目越权拒绝
  const followupsPath = '/api/coach/daily-todos/followups';
  const followAthleteId = restTarget.athleteId;
  const marked = await request(
    followupsPath,
    { method: 'PUT', body: JSON.stringify({ project, athleteIds: [followAthleteId] }) },
    coachToken
  );
  assert(
    marked.status === 200 && marked.payload.followedUp.includes(followAthleteId),
    '标记已跟进应返回当前名单'
  );
  assert(
    (await request(followupsPath, { method: 'PUT', body: JSON.stringify({ project, athleteIds: [followAthleteId] }) }, coachToken)).status === 200,
    '重复标记必须幂等'
  );
  assert(
    ((await read()).payload.todos.followedUp || []).includes(followAthleteId),
    '待办响应应携带当前用户已跟进名单'
  );
  assert(
    (
      await request(
        followupsPath,
        { method: 'PUT', body: JSON.stringify({ project, athleteIds: [followAthleteId] }) },
        athleteLogin.payload.token
      )
    ).status === 403,
    '运动员不能标记已跟进'
  );
  assert(
    (
      await request(
        followupsPath,
        { method: 'PUT', body: JSON.stringify({ project: 'CANOE_SPRINT', athleteIds: [followAthleteId] }) },
        coachToken
      )
    ).status === 403,
    '跨项目标记应被拒绝'
  );
  const unmarked = await request(
    `${followupsPath}?project=${project}&athleteIds=${followAthleteId}`,
    { method: 'DELETE' },
    coachToken
  );
  assert(
    unmarked.status === 200 && !unmarked.payload.followedUp.includes(followAthleteId),
    '撤销已跟进应从名单移除'
  );

  // 仅访问 api-check 自己创建的隔离数据库，不读取应用运行数据库。
  const fixtureDb = new DatabaseSync(databasePath);
  try {
    const grants = fixtureDb
      .prepare('SELECT project, granted_by FROM user_project_permissions WHERE user_id = ?')
      .all(coachId);
    fixtureDb.prepare('DELETE FROM user_project_permissions WHERE user_id = ?').run(coachId);
    try {
      fixtureDb
        .prepare(
          "INSERT INTO user_project_permissions (user_id, project, granted_by) VALUES (?, 'CANOE_SPRINT', ?)"
        )
        .run(coachId, coachId);
      assert((await read()).status === 403, '项目授权被撤回后必须拒绝访问');
      const empty = await request('/api/coach/daily-todos?project=CANOE_SPRINT', {}, coachToken);
      assert(
        empty.status === 200 &&
          empty.payload.todos.counts.total === 0 &&
          allRows(empty.payload.todos).length === 0,
        '有项目权限但无队员时必须返回空范围'
      );
    } finally {
      fixtureDb.prepare('DELETE FROM user_project_permissions WHERE user_id = ?').run(coachId);
      for (const grant of grants)
        fixtureDb
          .prepare(
            'INSERT INTO user_project_permissions (user_id, project, granted_by) VALUES (?, ?, ?)'
          )
          .run(coachId, grant.project, grant.granted_by);
    }
    const record = fixtureDb
      .prepare(
        "SELECT id FROM training_sessions WHERE athlete_id = ? AND content = '每日待办API回归'"
      )
      .get(target.athleteId);
    fixtureDb.prepare("UPDATE training_sessions SET start_time = '' WHERE id = ?").run(record.id);
    const incomplete = (await read()).payload.todos;
    assert(
      incomplete.incompleteTime.some((row) => row.athleteId === target.athleteId),
      '缺少时间必须单列提示'
    );
    assert(
      !incomplete.attention.some((row) => row.athleteId === target.athleteId && row.highLoad),
      '缺少时间不能伪造24小时负荷'
    );
    fixtureDb
      .prepare('UPDATE training_sessions SET start_time = ?, is_demo = 1 WHERE id = ?')
      .run(startTime, record.id);
    assert(
      (await read()).payload.todos.missing.some((row) => row.athleteId === target.athleteId),
      '演示标志记录不应消除正式填报待办'
    );
    fixtureDb.prepare('UPDATE training_sessions SET is_demo = 0 WHERE id = ?').run(record.id);

    fixtureDb.prepare('UPDATE athletes SET active = 0 WHERE id = ?').run(target.athleteId);
    try {
      const inactive = (await read()).payload.todos;
      assert(
        inactive.counts.total === scopedIds.length - 1 &&
          !allRows(inactive).some((row) => row.athleteId === target.athleteId),
        '停用运动员不能出现在待办中'
      );
    } finally {
      fixtureDb.prepare('UPDATE athletes SET active = 1 WHERE id = ?').run(target.athleteId);
    }
    const teamGrants = fixtureDb
      .prepare(
        'SELECT project, team, granted_by FROM user_team_permissions WHERE user_id = ?'
      )
      .all(coachId);
    fixtureDb.prepare('DELETE FROM user_team_permissions WHERE user_id = ?').run(coachId);
    try {
      assert(
        !allRows((await read()).payload.todos).some((row) => row.athleteId === target.athleteId),
        '移除队伍权限后不得沿用旧范围'
      );
    } finally {
      const restoreTeam = fixtureDb.prepare(
        'INSERT INTO user_team_permissions (user_id, project, team, granted_by) VALUES (?, ?, ?, ?)'
      );
      for (const grant of teamGrants)
        restoreTeam.run(coachId, grant.project, grant.team, grant.granted_by);
    }
  } finally {
    fixtureDb.close();
  }

  for (const otherProject of ['CANOE_SPRINT', 'CANOE_SLALOM']) {
    const other = await request(`/api/coach/daily-todos?project=${otherProject}`, {}, adminToken);
    assert(
      other.status === 200 &&
        allRows(other.payload.todos).every((row) => row.project === otherProject),
      '每日待办项目必须隔离'
    );
    const coachOther = await request(
      `/api/coach/daily-todos?project=${otherProject}`,
      {},
      coachToken
    );
    assert(
      coachOther.status === 403 ||
        (coachOther.status === 200 && coachOther.payload.todos.counts.total === 0),
      '无队员的项目不得返回别人的名单'
    );
  }
}
