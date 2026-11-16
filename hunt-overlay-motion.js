(function(root,factory){
  'use strict';
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HuntOverlayMotion=api;
})(typeof window!=='undefined'?window:this,function(){
  'use strict';

  function create(options){
    options=options||{};
    var viewport=options.viewport;
    if(!viewport)throw new Error('An overlay slot viewport is required.');
    var rowHeight=positive(options.rowHeight,44);
    var visibleRows=Math.max(1,Math.floor(positive(options.visibleRows,8)));
    var speed=positive(options.pixelsPerSecond,12);
    var pauseMs=typeof options.pauseMs==='number'?Math.max(0,options.pauseMs):2000;
    var requestFrame=options.requestFrame||(typeof requestAnimationFrame==='function'?requestAnimationFrame.bind(window):null);
    var cancelFrame=options.cancelFrame||(typeof cancelAnimationFrame==='function'?cancelAnimationFrame.bind(window):function(){});
    var now=options.now||function(){return typeof performance!=='undefined'?performance.now():Date.now();};
    var reduced=typeof options.reducedMotion==='function'?options.reducedMotion:function(){
      if(typeof options.reducedMotion==='boolean')return options.reducedMotion;
      return typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
    };
    var huntId=null,mode='idle',direction=1,focusIndex=-1,focusId=null;
    var previous=new Map(),rowCount=0,target=0,browsePosition=0,followPosition=0,pauseUntil=0,lastFrameTime=null,frameId=null,destroyed=false;

    function positive(value,fallback){return typeof value==='number'&&Number.isFinite(value)&&value>0?value:fallback;}
    function opened(row){return row.payout!==null&&row.payout!==undefined;}
    function position(){return Math.max(0,Number(viewport.scrollTop)||0);}
    function maxScroll(){
      var expected=Math.max(0,(rowCount-visibleRows)*rowHeight);
      var actual=Number(viewport.scrollHeight)-Number(viewport.clientHeight);
      return Number(viewport.clientHeight)>0&&Number(viewport.scrollHeight)>0?Math.max(0,actual):expected;
    }
    function clamp(value){return Math.max(0,Math.min(maxScroll(),value));}
    function setPosition(value){viewport.scrollTop=clamp(value);}
    function stop(){if(frameId!==null)cancelFrame(frameId);frameId=null;lastFrameTime=null;}
    function needsFrame(){
      if(destroyed||reduced()||!requestFrame)return false;
      return mode==='browsing'&&maxScroll()>0||mode==='following'&&Math.abs(followPosition-target)>.4;
    }
    function schedule(){if(frameId===null&&needsFrame())frameId=requestFrame(tick);}
    function tick(timestamp){
      frameId=null;
      if(destroyed||reduced())return;
      var t=typeof timestamp==='number'?timestamp:now();
      var elapsed=lastFrameTime===null?0:Math.max(0,Math.min(100,t-lastFrameTime));
      lastFrameTime=t;
      if(mode==='browsing'&&maxScroll()>0){
        if(t>=pauseUntil){
          // Preserve sub-pixel travel even when a browser rounds scrollTop.
          // Reading the rounded DOM value each frame can otherwise discard
          // every slow-scroll increment and leave the list permanently still.
          // Only time after the pause deadline contributes to travel. A frame
          // straddling the deadline must not shorten the two-second freeze.
          var activeElapsed=Math.min(elapsed,Math.max(0,t-pauseUntil));
          var next=browsePosition+speed*activeElapsed/1000;
          // Collection loops are one-way: jump directly to the top, pause,
          // then continue down. Upward motion is reserved for result focus.
          if(next>=maxScroll()){next=0;pauseUntil=t+pauseMs;}
          browsePosition=next;
          setPosition(next);
        }
      }else if(mode==='following'){
        target=clamp(target);
        var distance=target-followPosition;
        followPosition=clamp(Math.abs(distance)<.5?target:followPosition+distance*(1-Math.exp(-elapsed/160)));
        setPosition(followPosition);
        if(Math.abs(target-followPosition)<=.4){followPosition=target;setPosition(target);}
      }
      if(needsFrame())schedule();else lastFrameTime=null;
    }
    function getState(){return{mode:mode,focusIndex:focusIndex,focusId:focusId,position:position(),target:target,maxScroll:maxScroll(),direction:direction,running:frameId!==null};}
    function update(hunt){
      if(destroyed)return getState();
      hunt=hunt||{};
      var rows=Array.isArray(hunt.rows)?hunt.rows:[];
      var switched=hunt.id!==huntId;
      var following=hunt.status==='opening'||hunt.status==='complete'||rows.some(opened);
      var nextMode=following?'following':rows.length>visibleRows?'browsing':'idle';
      var transition=nextMode!==mode;
      rowCount=rows.length;
      if(switched){
        stop();huntId=hunt.id;previous=new Map();direction=1;focusIndex=-1;focusId=null;target=0;browsePosition=0;followPosition=0;setPosition(0);pauseUntil=now()+pauseMs;
      }
      if(transition&&!switched){
        stop();direction=1;target=0;browsePosition=0;followPosition=0;setPosition(0);pauseUntil=now()+pauseMs;
        if(nextMode!=='following'){focusIndex=-1;focusId=null;}
      }
      mode=nextMode;
      if(mode==='following'){
        var changed=-1,lastOpened=-1;
        rows.forEach(function(row,index){
          if(opened(row))lastOpened=index;
          if(previous.has(row.id)?previous.get(row.id)!==row.payout:opened(row))changed=index;
        });
        // A reload has no edit ordering, so the furthest opened bonus is the
        // useful position. Later updates follow the exact changed payout,
        // including corrections, out-of-order entries and zero-value busts.
        if(changed>=0)focusIndex=changed;
        else if(switched||transition)focusIndex=Math.max(0,lastOpened);
        else if(focusId!==null){var retained=rows.findIndex(function(row){return row.id===focusId;});if(retained>=0)focusIndex=retained;}
        focusIndex=rows.length?Math.min(Math.max(0,focusIndex),rows.length-1):-1;
        focusId=focusIndex>=0?rows[focusIndex].id:null;
        target=clamp(Math.max(0,focusIndex-1)*rowHeight);
        if(!switched&&!transition&&Math.abs(position()-followPosition)>1.1)followPosition=position();
        followPosition=clamp(followPosition);
        if(reduced()){followPosition=target;setPosition(target);}
      }else{
        target=0;
        if(mode==='browsing'){
          // A substantial difference indicates an external scroll; ordinary
          // pixel rounding is intentionally ignored across identical polls.
          if(!switched&&!transition&&Math.abs(position()-browsePosition)>1.1)browsePosition=position();
          browsePosition=clamp(browsePosition);setPosition(browsePosition);
        }else{browsePosition=0;setPosition(0);}
      }
      previous=new Map(rows.map(function(row){return[row.id,row.payout];}));
      if(!needsFrame())stop();else schedule();
      return getState();
    }
    function destroy(){destroyed=true;stop();previous.clear();}
    return{update:update,destroy:destroy,getState:getState};
  }
  return{create:create};
});
