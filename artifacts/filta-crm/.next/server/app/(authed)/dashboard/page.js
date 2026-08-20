(()=>{var e={};e.id=9679,e.ids=[9679],e.modules={72934:e=>{"use strict";e.exports=require("next/dist/client/components/action-async-storage.external.js")},54580:e=>{"use strict";e.exports=require("next/dist/client/components/request-async-storage.external.js")},45869:e=>{"use strict";e.exports=require("next/dist/client/components/static-generation-async-storage.external.js")},20399:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},84770:e=>{"use strict";e.exports=require("crypto")},8678:e=>{"use strict";e.exports=import("pg")},72254:e=>{"use strict";e.exports=require("node:buffer")},6005:e=>{"use strict";e.exports=require("node:crypto")},47261:e=>{"use strict";e.exports=require("node:util")},32267:(e,t,s)=>{"use strict";s.a(e,async(e,a)=>{try{s.r(t),s.d(t,{GlobalError:()=>c.a,__next_app__:()=>h,originalPathname:()=>x,pages:()=>p,routeModule:()=>b,tree:()=>f});var r=s(82792),n=s(51665);s(78714),s(40603);var l=s(73653),i=s(94966),o=s(56070),c=s.n(o),d=s(82555),u={};for(let e in d)0>["default","tree","pages","GlobalError","originalPathname","__next_app__","routeModule"].indexOf(e)&&(u[e]=()=>d[e]);s.d(t,u);var m=e([r,n]);[r,n]=m.then?(await m)():m;let f=["",{children:["(authed)",{children:["dashboard",{children:["__PAGE__",{},{page:[()=>Promise.resolve().then(s.bind(s,82792)),"/home/runner/workspace/artifacts/filta-crm/src/app/(authed)/dashboard/page.tsx"]}]},{}]},{layout:[()=>Promise.resolve().then(s.bind(s,51665)),"/home/runner/workspace/artifacts/filta-crm/src/app/(authed)/layout.tsx"],"not-found":[()=>Promise.resolve().then(s.t.bind(s,78714,23)),"next/dist/client/components/not-found-error"],metadata:{icon:[],apple:[],openGraph:[],twitter:[],manifest:"/manifest.webmanifest"}}]},{layout:[()=>Promise.resolve().then(s.bind(s,40603)),"/home/runner/workspace/artifacts/filta-crm/src/app/layout.tsx"],"not-found":[()=>Promise.resolve().then(s.t.bind(s,78714,23)),"next/dist/client/components/not-found-error"],metadata:{icon:[],apple:[],openGraph:[],twitter:[],manifest:"/manifest.webmanifest"}}],p=["/home/runner/workspace/artifacts/filta-crm/src/app/(authed)/dashboard/page.tsx"],x="/(authed)/dashboard/page",h={require:s,loadChunk:()=>Promise.resolve()},b=new l.AppPageRouteModule({definition:{kind:i.x.APP_PAGE,page:"/(authed)/dashboard/page",pathname:"/dashboard",bundlePath:"",filename:"",appPaths:[]},userland:{loaderTree:f}});a()}catch(e){a(e)}})},64458:(e,t,s)=>{Promise.resolve().then(s.bind(s,67215)),Promise.resolve().then(s.t.bind(s,70307,23))},67215:(e,t,s)=>{"use strict";s.d(t,{default:()=>n});var a=s(82064),r=s(25032);function n(){let[e,t]=(0,r.useState)("daily"),[s,n]=(0,r.useState)(null),[l,i]=(0,r.useState)(null),[o,c]=(0,r.useTransition)();return(0,a.jsxs)("div",{className:"flex flex-wrap items-center gap-2 text-sm",children:[(0,a.jsxs)("select",{value:e,onChange:e=>t(e.target.value),disabled:o,className:"rounded-md border border-slate-300 bg-white px-2 py-1 text-xs",children:[a.jsx("option",{value:"daily",children:"Daily"}),a.jsx("option",{value:"weekly",children:"Weekly"})]}),a.jsx("button",{type:"button",onClick:function(){i(null),n(null),window.confirm(`Send the ${e} digest now to all admin users?`)&&c(async()=>{try{let t=await fetch(`/api/digests/run?type=${e}`,{method:"POST",credentials:"include"}),s=await t.json();if(!t.ok||!s.ok){i(s.error??`Failed (${t.status})`);return}n(`Sent to ${s.sent} admin${1===s.sent?"":"s"}${s.failed?` (${s.failed} failed)`:""}`)}catch(e){i(e instanceof Error?e.message:String(e))}})},disabled:o,className:"rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60",children:o?"Sending…":"Send digest now"}),s?a.jsx("span",{className:"text-xs text-emerald-700",children:s}):null,l?a.jsx("span",{className:"text-xs text-red-700",children:l}):null]})}},88335:(e,t,s)=>{"use strict";s.d(t,{Z:()=>a});let a=(0,s(61924).createProxy)(String.raw`/home/runner/workspace/artifacts/filta-crm/src/app/(authed)/dashboard/SendDigestButton.tsx#default`)},82792:(e,t,s)=>{"use strict";s.a(e,async(e,a)=>{try{s.r(t),s.d(t,{default:()=>m,dynamic:()=>b});var r=s(49222),n=s(13023),l=s(74966),i=s(63932),o=s(90884),c=s(48507),d=s(88335),u=e([i,c]);[i,c]=u.then?(await u)():u;let b="force-dynamic",v={ff:"FiltaFry",fs:"FiltaClean",fb:"FiltaBio",fg:"FiltaGold",fc:"FiltaCool",fd:"FiltaDrain"},g={ff:"bg-blue-500",fs:"bg-teal-500",fb:"bg-emerald-500",fg:"bg-amber-500",fc:"bg-sky-400",fd:"bg-violet-500"};async function m(){let e=await (0,o.oT)(),t=await (0,c.getTaskCountsForUser)(),s=(0,l.i6)``;"fun_coast"===e.territory?s=(0,l.i6)`and a.territory = 'fun_coast'`:"space_coast"===e.territory&&(s=(0,l.i6)`and a.territory = 'space_coast'`);let[a]=(await i.db.execute((0,l.i6)`
      select
        count(*) filter (where a.deleted_at is null)::int as accounts,
        count(*) filter (where a.account_status = 'customer' and a.deleted_at is null)::int as customers,
        count(*) filter (
          where a.account_status = 'customer'
            and a.deleted_at is null
            and (a.service_profile->'fs'->>'active')::boolean = true
        )::int as fs_customers,
        count(*) filter (
          where a.account_status = 'customer'
            and a.deleted_at is null
            and (a.service_profile->'ff'->>'active')::boolean = true
        )::int as ff_customers,
        coalesce(sum(
          case when a.account_status = 'customer' and a.deleted_at is null then
            coalesce((a.service_profile->'ff'->>'monthly_revenue')::numeric, 0) +
            coalesce((a.service_profile->'fs'->>'monthly_revenue')::numeric, 0) +
            coalesce((a.service_profile->'fb'->>'monthly_revenue')::numeric, 0) +
            coalesce((a.service_profile->'fg'->>'monthly_revenue')::numeric, 0) +
            coalesce((a.service_profile->'fc'->>'monthly_revenue')::numeric, 0) +
            coalesce((a.service_profile->'fd'->>'monthly_revenue')::numeric, 0)
          else 0 end
        ), 0)::numeric as total_mrr
      from accounts a
      where 1 = 1
        ${s}
    `)).rows,u=a?.customers??0,m=a?.ff_customers??0,b=a?.fs_customers??0,_=Number(a?.total_mrr??0),w=m>0?b/m*100:0,[y]=(await i.db.execute((0,l.i6)`
      select count(*)::int as count
      from accounts a
      where a.account_status = 'customer'
        and a.deleted_at is null
        and (a.service_profile->'ff'->>'active')::boolean = true
        and coalesce((a.service_profile->'fs'->>'active')::boolean, false) = false
        and not exists (
          select 1 from opportunities o
          where o.account_id = a.id
            and o.service_type = 'fs'
            and o.stage not in ('closed_won','closed_lost')
            and o.deleted_at is null
        )
        ${s}
    `)).rows,j=y?.count??0,[N]=(await i.db.execute((0,l.i6)`
      select count(*)::int as count
      from opportunities o
      join accounts a on a.id = o.account_id
      where o.deleted_at is null
        and o.stage not in ('closed_won','closed_lost')
        ${s}
    `)).rows,$=N?.count??0,[k]=(await i.db.execute((0,l.i6)`
      select
        sum(coalesce((a.service_profile->'ff'->>'monthly_revenue')::numeric, 0))::numeric as ff,
        sum(coalesce((a.service_profile->'fs'->>'monthly_revenue')::numeric, 0))::numeric as fs,
        sum(coalesce((a.service_profile->'fb'->>'monthly_revenue')::numeric, 0))::numeric as fb,
        sum(coalesce((a.service_profile->'fg'->>'monthly_revenue')::numeric, 0))::numeric as fg,
        sum(coalesce((a.service_profile->'fc'->>'monthly_revenue')::numeric, 0))::numeric as fc,
        sum(coalesce((a.service_profile->'fd'->>'monthly_revenue')::numeric, 0))::numeric as fd
      from accounts a
      where a.account_status = 'customer'
        and a.deleted_at is null
        ${s}
    `)).rows,F=k?{ff:Number(k.ff??0),fs:Number(k.fs??0),fb:Number(k.fb??0),fg:Number(k.fg??0),fc:Number(k.fc??0),fd:Number(k.fd??0)}:{ff:0,fs:0,fb:0,fg:0,fc:0,fd:0},S=Object.values(F).reduce((e,t)=>e+t,0),P=(await i.db.execute((0,l.i6)`
      select
        a.id,
        a.company_name,
        a.territory,
        (
          coalesce((a.service_profile->'ff'->>'monthly_revenue')::numeric, 0) +
          coalesce((a.service_profile->'fs'->>'monthly_revenue')::numeric, 0) +
          coalesce((a.service_profile->'fb'->>'monthly_revenue')::numeric, 0) +
          coalesce((a.service_profile->'fg'->>'monthly_revenue')::numeric, 0) +
          coalesce((a.service_profile->'fc'->>'monthly_revenue')::numeric, 0) +
          coalesce((a.service_profile->'fd'->>'monthly_revenue')::numeric, 0)
        )::numeric as mrr
      from accounts a
      where a.account_status = 'customer'
        and a.deleted_at is null
        ${s}
      order by mrr desc nulls last
      limit 10
    `)).rows.map(e=>({id:e.id,name:e.company_name,territory:e.territory,mrr:Number(e.mrr??0),pctOfTotal:_>0?Number(e.mrr??0)/_*100:0})),[T]=(await i.db.execute((0,l.i6)`
      with fs_sends as (
        select es.account_id, es.id as send_id, es.open_count, es.replied_at
        from email_sends es
        join message_templates mt on mt.id = es.template_id
        join accounts a on a.id = es.account_id
        where mt.purpose = 'fs_cross_sell'
          and a.deleted_at is null
          ${s}
      )
      select
        (select count(distinct account_id) from fs_sends)::int as emailed,
        (select count(distinct account_id) from fs_sends where open_count > 0)::int as opened,
        (select count(distinct account_id) from fs_sends where replied_at is not null)::int as replied,
        (
          select count(distinct o.account_id)::int
          from opportunities o
          join accounts a on a.id = o.account_id
          where o.service_type = 'fs'
            and o.stage not in ('closed_won','closed_lost')
            and o.deleted_at is null
            and a.deleted_at is null
            ${s}
        ) as open_opp,
        (
          select count(distinct o.account_id)::int
          from opportunities o
          join accounts a on a.id = o.account_id
          where o.service_type = 'fs'
            and o.stage = 'closed_won'
            and o.deleted_at is null
            and a.deleted_at is null
            ${s}
        ) as won
    `)).rows,M=[{label:"Targeted",value:j},{label:"Emailed",value:T?.emailed??0},{label:"Opened",value:T?.opened??0},{label:"Replied",value:T?.replied??0},{label:"Open opp",value:T?.open_opp??0},{label:"Won",value:T?.won??0}],O=Math.max(1,...M.map(e=>e.value));return(0,r.jsxs)("div",{className:"space-y-8",children:[(0,r.jsxs)("section",{className:"flex flex-wrap items-start justify-between gap-3",children:[(0,r.jsxs)("div",{children:[(0,r.jsxs)("h1",{className:"text-2xl font-semibold tracking-tight text-slate-900",children:["Welcome back, ",e.email.split("@")[0],"."]}),(0,r.jsxs)("p",{className:"mt-1 text-sm text-slate-600",children:[new Date().toLocaleDateString(void 0,{weekday:"long",month:"long",day:"numeric",year:"numeric"})," \xb7 ","both"===e.territory?"All territories":"fun_coast"===e.territory?"Fun Coast":"Space Coast"]})]}),"admin"===e.role?r.jsx(d.Z,{}):null]}),(0,r.jsxs)("section",{className:"grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6",children:[r.jsx(f,{label:"Customers",value:u.toLocaleString()}),r.jsx(f,{label:"MRR",value:h(_)}),r.jsx(f,{label:"FS attach rate",value:`${w.toFixed(1)}%`,sub:`${b} of ${m} FF`,accent:w<20?"warning":void 0}),r.jsx(f,{label:"Cross-sell targets",value:j.toLocaleString(),href:"/cross-sell"}),r.jsx(f,{label:"Open opportunities",value:$.toLocaleString(),href:"/pipeline"}),r.jsx(f,{label:"Today",value:(t.overdue+t.today).toLocaleString(),sub:t.overdue>0?`${t.overdue} overdue`:`${t.thisWeek} this week`,accent:t.overdue>0?"warning":void 0,href:"/today"})]}),(0,r.jsxs)("section",{className:"grid gap-4 lg:grid-cols-2",children:[r.jsx(p,{title:"MRR by service",children:0===S?r.jsx("p",{className:"text-sm text-slate-500",children:"No revenue data yet. Run the billing import to populate service profiles."}):r.jsx("div",{className:"space-y-2",children:["ff","fs","fb","fg","fc","fd"].map(e=>{let t=F[e],s=S>0?t/S*100:0;return 0===t?null:(0,r.jsxs)("div",{children:[(0,r.jsxs)("div",{className:"flex items-baseline justify-between text-sm",children:[r.jsx("span",{className:"font-medium text-slate-900",children:v[e]}),(0,r.jsxs)("span",{className:"tabular-nums text-slate-700",children:[h(t),(0,r.jsxs)("span",{className:"ml-2 text-xs text-slate-500",children:[s.toFixed(1),"%"]})]})]}),r.jsx("div",{className:"mt-1 h-2 overflow-hidden rounded bg-slate-100",children:r.jsx("div",{className:`h-full ${g[e]}`,style:{width:`${Math.max(2,s)}%`}})})]},e)})})}),r.jsx(p,{title:"Top 10 customer concentration",subtitle:P.length>0&&_>0?`Top 10 = ${(P.reduce((e,t)=>e+t.mrr,0)/_*100).toFixed(1)}% of MRR`:void 0,children:0===P.length?r.jsx("p",{className:"text-sm text-slate-500",children:"No customers in scope yet."}):r.jsx("ol",{className:"space-y-1.5 text-sm",children:P.map((e,t)=>{let s=/ocean breeze/i.test(e.name)||e.pctOfTotal>=10;return(0,r.jsxs)("li",{className:"flex items-baseline justify-between gap-2",children:[(0,r.jsxs)("div",{className:"min-w-0 flex-1 truncate",children:[(0,r.jsxs)("span",{className:"mr-2 inline-block w-5 text-right text-xs text-slate-400",children:[t+1,"."]}),r.jsx(n.default,{href:`/accounts/${e.id}`,className:"font-medium text-slate-900 hover:underline",children:e.name}),s?(0,r.jsxs)("span",{title:"High concentration risk",className:"ml-2 rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-700",children:[e.pctOfTotal.toFixed(1),"%"]}):null]}),(0,r.jsxs)("div",{className:"shrink-0 text-right tabular-nums",children:[(0,r.jsxs)("div",{className:"text-slate-700",children:[h(e.mrr),"/mo"]}),s?null:(0,r.jsxs)("div",{className:"text-xs text-slate-500",children:[e.pctOfTotal.toFixed(1),"%"]})]})]},e.id)})})})]}),(0,r.jsxs)(p,{title:"FiltaClean cross-sell funnel",subtitle:"Targeted → emailed → opened → replied → open opp → won",children:[r.jsx("div",{className:"grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6",children:M.map((e,t)=>{let s=t>0?M[t-1].value:null,a=null!=s&&s>0?`${(e.value/s*100).toFixed(0)}%`:null,n=e.value/O*100;return(0,r.jsxs)("div",{className:"rounded-md border border-slate-200 bg-white p-3",children:[r.jsx("div",{className:"text-xs font-medium uppercase tracking-wide text-slate-500",children:e.label}),r.jsx("div",{className:"mt-1 text-2xl font-semibold text-slate-900",children:e.value.toLocaleString()}),r.jsx("div",{className:"mt-2 h-1.5 overflow-hidden rounded bg-slate-100",children:r.jsx("div",{className:"h-full bg-service-fs",style:{width:`${Math.max(3,n)}%`}})}),r.jsx("div",{className:"mt-1 text-[11px] text-slate-500",children:a?`↓ ${a} from prior`:"starting set"})]},e.label)})}),r.jsx("p",{className:"mt-3 text-xs text-slate-500",children:'"Emailed" / "Opened" / "Replied" count distinct accounts that received at least one FS cross-sell template send. "Won" is lifetime; the others are point-in-time.'})]}),(0,r.jsxs)("section",{className:"grid gap-4 md:grid-cols-3",children:[r.jsx(x,{href:"/today",eyebrow:t.overdue>0?"Needs attention":"Today",eyebrowTone:t.overdue>0?"warning":"primary",title:t.overdue+t.today===0?"You're caught up":`${t.overdue+t.today} follow-up${t.overdue+t.today===1?"":"s"}`,body:t.overdue>0?`${t.overdue} overdue \xb7 ${t.today} due today \xb7 ${t.thisWeek} later this week.`:`${t.today} due today \xb7 ${t.thisWeek} later this week.`,cta:"Open Today →"}),r.jsx(x,{href:"/cross-sell",eyebrow:"Biggest opportunity",eyebrowTone:"success",title:`FiltaClean cross-sell: ${j} targets`,body:"FF customers without FS — ~70% gross margin service we're leaving on the table.",cta:"Open cross-sell →"}),r.jsx(x,{href:"/at-risk",eyebrow:"Retention",eyebrowTone:"warning",title:"At-risk customers",body:"Service overdue, bouncing emails, dormant relationships, stuck FS opps.",cta:"Open at-risk queue →"})]})]})}function f({label:e,value:t,sub:s,accent:a,href:l}){let i=(0,r.jsxs)("div",{className:"rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:border-slate-300",children:[r.jsx("div",{className:"text-xs font-medium uppercase tracking-wide text-slate-500",children:e}),r.jsx("div",{className:`mt-1 text-2xl font-semibold ${"warning"===a?"text-rose-700":"text-slate-900"}`,children:t}),s?r.jsx("div",{className:"mt-0.5 text-xs text-slate-500",children:s}):null]});return l?r.jsx(n.default,{href:l,className:"block",children:i}):i}function p({title:e,subtitle:t,children:s}){return(0,r.jsxs)("section",{className:"rounded-lg border border-slate-200 bg-white p-4 shadow-sm",children:[(0,r.jsxs)("div",{className:"mb-3 flex items-baseline justify-between gap-2",children:[r.jsx("h2",{className:"text-sm font-semibold uppercase tracking-wide text-slate-500",children:e}),t?r.jsx("span",{className:"text-xs text-slate-500",children:t}):null]}),s]})}function x({href:e,eyebrow:t,eyebrowTone:s,title:a,body:l,cta:i}){return(0,r.jsxs)(n.default,{href:e,className:"group rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow",children:[r.jsx("div",{className:`text-xs font-semibold uppercase tracking-wide ${"warning"===s?"text-rose-700":"success"===s?"text-emerald-700":"text-filta-blue"}`,children:t}),r.jsx("div",{className:"mt-2 text-xl font-semibold text-slate-900",children:a}),r.jsx("p",{className:"mt-1 text-sm text-slate-600",children:l}),r.jsx("div",{className:"mt-3 text-sm font-medium text-slate-900 group-hover:underline",children:i})]})}function h(e){return Number.isFinite(e)&&0!==e?Math.abs(e)>=1e6?`$${(e/1e6).toFixed(2)}M`:Math.abs(e)>=1e3?`$${Math.round(e/1e3).toLocaleString()}K`:`$${Math.round(e).toLocaleString()}`:"$0"}a()}catch(e){a(e)}})}};var t=require("../../../webpack-runtime.js");t.C(e);var s=e=>t(t.s=e),a=t.X(0,[3867,8734,80,1068,8977,307,8557,5239,2244,613,9664],()=>s(32267));module.exports=a})();