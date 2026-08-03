// wslink-v8.js — local fork. Desktop link (dlws) entirely removed.
// Journal WebSocket connects to the local Node server instead of zero-network.net.

let ws = null

var ws_ping;

var state_received = false
var map_loaded = false

let broadcast_interval = null
let broadcast_closing = false
var muteBroadcast = false
let broadcast_audio = new Audio("assets/broadcast-alert.mp3")
broadcast_audio.preload = 'auto';
broadcast_audio.load();

var my_pos = 0
var pos_colors = {
    1:"ff0000",
    2:"00ff00",
    3:"0000ff",
    4:"ca36dd"
}

// Globals expected by removed modules
var data_user  = {}
// polled and hasDLLink are declared with `let` in filter-v15.js

// --------------- Override WS send (queue messages while CONNECTING)

const wssend = WebSocket.prototype.send

WebSocket.prototype.send = function(message){
    if(this.readyState == WebSocket.OPEN){
        wssend.call(this, message)
    }
    else if(this.readyState == WebSocket.CONNECTING){
        const timeout = setTimeout(() => {
            if(this.readyState != WebSocket.OPEN){
                console.error("Socket did not open in time, message not sent")
            }
        },5000)
        const interval = setInterval(() => {
            if(this.readyState === WebSocket.OPEN){
                clearTimeout(timeout)
                clearInterval(interval)
                wssend.call(this,message)
            }
        },250)
    }
    else{
        console.warn("Socket not open or connecting. Failed to send message")
    }
}

// ── Broadcast banner ──────────────────────────────────────────────────────────

function mute_broadcast(){
    muteBroadcast = document.getElementById("mute_broadcast").checked
}

function close_broadcast(){
    broadcast_closing = true
    clearInterval(broadcast_interval);
    $("#broadcast").fadeOut(500)
    document.getElementById("broadcast-timer-bar").style.width = "100%";
}

function broadcast(message, remain=10000, play_sound = true){
    broadcast_closing = false
    clearInterval(broadcast_interval);
    document.getElementById("broadcast-message").innerText = message;

    if(play_sound && !muteBroadcast){
        broadcast_audio.volume = volume
        broadcast_audio.play()
    }

    $("#broadcast").fadeIn(500)
    let timerBar = document.getElementById("broadcast-timer-bar");
    let duration = 10000
    let timeLeft = remain

    broadcast_interval = setInterval(() => {
        timeLeft -= 100;
        const widthPercent = (timeLeft / duration) * 100;
        timerBar.style.width = `${widthPercent}%`;
        if (timeLeft <= 0) {
            clearInterval(broadcast_interval);
            $("#broadcast").fadeOut(500)
        }
    }, 100);
}

function pause_broadcast(){
    clearInterval(broadcast_interval);
}

function resume_broadcast(){
    if (!broadcast_closing){
        broadcast(
            document.getElementById("broadcast-message").innerText,
            parseFloat(document.getElementById("broadcast-timer-bar").style.width)/100 * 10000,
            false
        )
    }
}

// ── Room auto-connect ─────────────────────────────────────────────────────────

function auto_link(){
    var room_id = getCookie("room_id")
    if(room_id){
        var r = document.getElementById("room_id")
        setTimeout(function(){
            r.value = room_id
            link_room()
        },1)
    }
    // Desktop link auto-link intentionally removed
}

function copy_url_code(){
    var copyText = document.getElementById("room_id").value
    ZNCopyShare(`${window.location.href.split("?")[0]}?journal=${copyText}`,"Copy Room URL")
    $("#room_id_cover").fadeIn(150)
    setTimeout(function(){
        $("#room_id_cover").fadeOut(150)
    },1000)
}

// ── Room creation & connection ────────────────────────────────────────────────

function create_room(){
    var outgoing_state = {
        'evidence': state['evidence'],
        'speed': state['speed'],
        'los': state['los'],
        'sanity': state['sanity'],
        'ghosts': state['ghosts'],
        "map": state['map'],
        'settings': {
            "num_evidences":document.getElementById("num_evidence").value,
            "dif_name":document.getElementById("num_evidence").options[document.getElementById("num_evidence").selectedIndex].text,
            "cust_num_evidences":document.getElementById("cust_num_evidence").value,
            "cust_hunt_length":document.getElementById("cust_hunt_length").value,
            "cust_starting_sanity": document.getElementById("cust_starting_sanity").value,
            "cust_sanity_pill_rest": document.getElementById("cust_sanity_pill_rest").value,
            "cust_sanity_drain": document.getElementById("cust_sanity_drain").value,
            "cust_lobby_type": document.getElementById("cust_lobby_type").value,
            "ghost_modifier":parseInt(document.getElementById("ghost_modifier_speed").value)
        }
    }
    fetch(`/create-room`,{method:"POST",Accept:"application/json",body:JSON.stringify(outgoing_state),signal: AbortSignal.timeout(6000)})
    .then(response => response.json())
    .then(data => {
        var room_id = data['room_id']
        document.getElementById("room_id").value = room_id
        link_room()
    })
    .catch(response => {
        console.error(response)
    });
}

function link_room(){
    var room_id = document.getElementById("room_id").value
    var load_pos = getCookie("link-position")
    var proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${window.location.host}/room/${room_id}${load_pos ? '?pos='+load_pos : ''}`);
    setCookie("room_id",room_id,1)

    ws.onopen = function(event){
        hasLink = true;
        $("#room_id_create").hide()
        $("#room_id_link").hide()
        $("#room_id_disconnect").show()
        $('.card_icon_guess').show()
        document.getElementById("room_id_note").innerText = `${lang_data['{{status}}']}: ${lang_data['{{connected}}']}`
        document.getElementById("settings_status").className = "connected"
        ws_ping = setInterval(function(){
            send_ping()
        }, 30000)
    }
    ws.onerror = function(event){
        document.getElementById("room_id_note").innerText = `${lang_data['{{error}}']}: ${lang_data['{{could_not_connect}}']}`
        document.getElementById("settings_status").className = "error"
        setCookie("room_id","",-1)
    }
    ws.onmessage = function(event) {
        try {
            document.getElementById("settings_status").className = "connected"
            if(event.data == "-"){
                state_received = true
                return
            }
            var incoming_state = JSON.parse(event.data)

            if (incoming_state.hasOwnProperty("setpos")){
                my_pos = incoming_state["setpos"]
                setCookie("link-position",my_pos,1)
                pos_elem = document.getElementById("link_pos")
                pos_elem.innerText = my_pos
                pos_elem.style.border = `2px solid #${pos_colors[my_pos]}`
                pos_elem.style.backgroundColor = `#${pos_colors[my_pos]}44`
                $(pos_elem).show()
                if($(".guessed").length > 0){
                    send_guess($(".guessed")[0].id)
                }
                request_guess()
            }
            else if (incoming_state.hasOwnProperty("action")){
                action = incoming_state.action.toUpperCase()
                if (action == "RESET"){
                    reset(true)
                }
                if(action == "BROADCAST"){
                    document.getElementById("room_id_note").innerText = incoming_state['message']
                    broadcast(incoming_state['message'])
                }
                if (action == "UNLINK"){
                    document.getElementById("room_id_note").innerText = `${lang_data['{{status}}']}: ${lang_data['{{timeout}}']}`
                    document.getElementById("settings_status").className = "pending"
                    document.getElementById("room_id").value = ""
                    disconnect_room(false, true)
                    return
                }
                if (action == "GUESS"){
                    try { document.getElementById(`guess_pos_${incoming_state['pos']}`).remove()} catch (error) {}
                    if(incoming_state['ghost']){
                        document.getElementById(incoming_state['ghost']).querySelector(".ghost_guesses").innerHTML += `
                        <div id="guess_pos_${incoming_state['pos']}" class="ghost_guess" title="${incoming_state['ds_image'] ? incoming_state['ds_name'] : ('Player ' + incoming_state['pos'])}" style="${incoming_state['ds_image'] ? 'background-image: url('+incoming_state['ds_image']+');' : 'background-color: #'+pos_colors[incoming_state['pos']]+'44;'} border: 2px solid #${pos_colors[incoming_state['pos']]};">
                            ${incoming_state['ds_image'] ? "" : incoming_state['pos']}
                        </div>
                        `
                    }
                }
                if (action == "GUESSSTATE"){
                    if($(".guessed").length > 0){
                        send_guess($(".guessed")[0].id)
                    }
                }
                if (action == "TIMER") {
                    if (window.electronAPI) window.electronAPI.toggleTimer('smudge');
                }
                if (action == "COOLDOWNTIMER") {
                    if (window.electronAPI) window.electronAPI.toggleTimer('cooldown');
                }
                if (action == "HUNTTIMER") {
                    if (window.electronAPI) window.electronAPI.toggleTimer('hunt');
                }
                if (action == "CHANGE"){
                    document.getElementById("room_id_note").innerText = `STATUS: Connected (${incoming_state['players']})`
                    send_ml_state()
                }
                if (action == "EVIDENCE"){
                    if(!$(document.getElementById(incoming_state['evidence']).querySelector("#checkbox")).hasClass("block")){
                        tristate(document.getElementById(incoming_state['evidence']))
                    }
                }
                if (action == "POLL"){
                    polled = true
                    ws.send('{"action":"READY"}')
                    $("#reset").html(lang_data['{{waiting_for_others}}'])
                }
                return
            }

            else if (incoming_state.hasOwnProperty("error")){
                console.log(incoming_state)
                document.getElementById("room_id_note").innerText = `${lang_data['{{error}}']}: ${incoming_state['error']}!`
                document.getElementById("settings_status").className = "error"
                if (incoming_state.hasOwnProperty("disconnect") && incoming_state['disconnect']){
                    disconnect_room(false,true)
                }
                return
            }

            else{
                if (
                    document.getElementById("num_evidence").value != incoming_state['settings']['num_evidences'] ||
                    document.getElementById("cust_num_evidence").value != incoming_state['settings']['cust_num_evidences'] ||
                    document.getElementById("cust_hunt_length").value != incoming_state['settings']['cust_hunt_length'] ||
                    document.getElementById("cust_starting_sanity").value != incoming_state['settings']['cust_starting_sanity'] ||
                    document.getElementById("cust_sanity_pill_rest").value != incoming_state['settings']['cust_sanity_pill_rest'] ||
                    document.getElementById("cust_sanity_drain").value != incoming_state['settings']['cust_sanity_drain'] ||
                    document.getElementById("cust_lobby_type").value != incoming_state['settings']['cust_lobby_type']
                ){
                    if(incoming_state['settings']['num_evidences'] != document.getElementById("num_evidence").value){
                        $("#cust_num_evidence").removeAttr("disabled")
                        $("#cust_hunt_length").removeAttr("disabled")
                        $("#ghost_modifier_speed").removeAttr("disabled")
                        $("#ghost_modifier_speed").removeClass("prevent")
                        document.getElementById("num_evidence").style.width = "100%"
                        $("#weekly_icon").hide()
                    }
                    if(incoming_state['settings']['num_evidences'] != "")
                        document.getElementById("num_evidence").value = incoming_state['settings']['num_evidences']
                    if(incoming_state['settings']['cust_lobby_type'] != "")
                        document.getElementById("cust_lobby_type").value = incoming_state['settings']['cust_lobby_type']
                    if (["-5","-1"].includes(incoming_state['settings']['num_evidences']) || incoming_state['settings']['num_evidences'].match(/[0-9]{4}-[0-9]{4}-[0-9]{4}/g)){
                        if(incoming_state['settings']['cust_num_evidences'] != "")
                            document.getElementById("cust_num_evidence").value = incoming_state['settings']['cust_num_evidences']
                        if(incoming_state['settings']['cust_hunt_length'] != "")
                            document.getElementById("cust_hunt_length").value = incoming_state['settings']['cust_hunt_length']
                        if(incoming_state['settings']['cust_starting_sanity'] != "")
                            document.getElementById("cust_starting_sanity").value = incoming_state['settings']['cust_starting_sanity']
                        if(incoming_state['settings']['cust_sanity_pill_rest'] != "")
                            document.getElementById("cust_sanity_pill_rest").value = incoming_state['settings']['cust_sanity_pill_rest']
                        if(incoming_state['settings']['cust_sanity_drain'] != "")
                            document.getElementById("cust_sanity_drain").value = incoming_state['settings']['cust_sanity_drain']

                        if(incoming_state['settings']['num_evidences'] === "-5"){
                            $("#cust_num_evidence").attr("disabled","disabled")
                            $("#cust_hunt_length").attr("disabled","disabled")
                            $("#ghost_modifier_speed").attr("disabled","disabled")
                            $("#ghost_modifier_speed").addClass("prevent")
                            document.getElementById("num_evidence").style.width = "calc(100% - 28px)"
                            $("#weekly_icon").show()
                        }

                        if(incoming_state['settings']['num_evidences'].match(/[0-9]{4}-[0-9]{4}-[0-9]{4}/g)){
                            $("#cust_num_evidence").attr("disabled","disabled")
                            $("#cust_hunt_length").attr("disabled","disabled")
                            $("#ghost_modifier_speed").attr("disabled","disabled")
                            $("#ghost_modifier_speed").addClass("prevent")

                            if($("#num_evidence option[value='"+incoming_state['settings']['num_evidences']+"']").length === 0){
                                let presets = document.getElementById("num_evidence")

                                if($("#num_evidence option[value='sep4']").length === 0){
                                    var opt = document.createElement('option');
                                    opt.value = "sep4";
                                    opt.innerHTML = "----Shared----"
                                    opt.disabled = true
                                    presets.appendChild(opt)
                                }

                                var opt = document.createElement('option');
                                opt.value = incoming_state['settings']['num_evidences'];
                                opt.innerHTML = incoming_state['settings']['dif_name'];
                                opt.disabled = true
                                presets.appendChild(opt);

                                document.getElementById("num_evidence").value = incoming_state['settings']['num_evidences']
                            }
                        }
                    }
                    else{
                        set_sanity_settings()
                    }
                    updateMapDifficulty(incoming_state['settings']['num_evidences'])
                    showCustom()
                    flashMode()
                }

                if(document.getElementById("ghost_modifier_speed").value != incoming_state['settings']['ghost_modifier']){
                    document.getElementById("ghost_modifier_speed").value = incoming_state['settings']['ghost_modifier']
                }

                saveSettings()

                for (const [key, value] of Object.entries(incoming_state["ghosts"])){
                    if (value == 0 || value == 1){
                        if(state['ghosts'][key] == 2){
                            select(document.getElementById(key),true);
                            if(value == 0)
                                fade(document.getElementById(key),true);
                        }
                        else if(state['ghosts'][key] == -2){
                            died(document.getElementById(key),true);
                            if(value == 0)
                                fade(document.getElementById(key),true);
                        }
                        else if(state['ghosts'][key] == -1){
                            revive()
                        }
                        else if(state['ghosts'][key] != 3){
                            if((value == 0 && state['ghosts'][key] != 0) || (value == 1 && state['ghosts'][key] != 1)){
                                fade(document.getElementById(key),true);
                            }
                        }
                    }
                    else if (value == -1){
                        remove(document.getElementById(key),true);
                    }
                    else if(value == 2 || value == -2){
                        if(markedDead){
                            if(state['ghosts'][key] != -2){
                                died(document.getElementById(key),true);
                            }
                        }
                        else{
                            if(state['ghosts'][key] != 2){
                                select(document.getElementById(key),true);
                            }
                        }
                    }
                }

                if(incoming_state.hasOwnProperty("map")){
                    var map_exists = setInterval(function(){
                        if(document.getElementById(incoming_state['map']) != null){
                            state['map'] = incoming_state['map'];
                            var map_elem = document.getElementById(incoming_state["map"])
                            changeMap(map_elem,map_elem.onclick.toString().match(/(http.+?)'\)/)[1],true)
                            saveSettings()
                            clearInterval(map_exists)
                            map_loaded = true
                        }
                    },500)
                }

                prev_monkey_state = incoming_state["prev_monkey_state"] ?? 0

                var prev_evidence = state['evidence']
                var new_mp = false
                for (const [key, value] of Object.entries(incoming_state["evidence"])){

                    if(value == -2){
                        if(prev_evidence[key] != -2){
                            monkeyPawFilter($(document.getElementById(key)).parent().find(".monkey-paw-select"),true)
                            new_mp = true
                        }
                    }
                    else{
                        if(prev_evidence[key] == -2 && !new_mp){
                            monkeyPawFilter($(document.getElementById(key)).parent().find(".monkey-paw-select"),true)
                        }
                        while (!$(document.getElementById(key).querySelector("#checkbox")).hasClass(["bad","neutral","good"][value + 1])){
                            tristate(document.getElementById(key),true);
                        }
                    }
                }
                for (const [key, value] of Object.entries(incoming_state["speed"])){
                    while (!$(document.getElementById(key).querySelector("#checkbox")).hasClass(["neutral","good"][value])){
                        dualstate(document.getElementById(key),true);
                    }
                }
                for (const [key, value] of Object.entries(incoming_state["sanity"])){
                    while (!$(document.getElementById(key).querySelector("#checkbox")).hasClass(["neutral","good"][value])){
                        dualstate(document.getElementById(key),true,true);
                    }
                }

                if(incoming_state.hasOwnProperty("los")){
                    while (!$(document.getElementById("LOS").querySelector("#checkbox")).hasClass(["neutral","bad","good"][incoming_state["los"]+1])){
                        tristate(document.getElementById("LOS"),true,true);
                    }
                }

                if(incoming_state.hasOwnProperty("forest_minion")){
                    if(incoming_state["forest_minion"]){
                        toggleForestMinion(0, true, true)
                    }
                    else{
                        toggleForestMinion(1, true)
                    }
                }

                if(incoming_state.hasOwnProperty("coal")){
                    if(incoming_state["coal"]){
                        toggleCoal(true,false,true)
                    }
                    else{
                        toggleCoal(false,true,true)
                    }
                }

                if(incoming_state.hasOwnProperty("blood_moon")){
                    if(incoming_state["blood_moon"]){
                        toggleBloodMoon(true,false,true)
                    }
                    else{
                        toggleBloodMoon(false,true,true)
                    }
                }

                filter(true)
                state_received = true
            }

        } catch (error){
            console.log(error)
            console.log(event.data)
        }
    }
}

function continue_session(){
    if(hasLink){
        ws.send('{"action":"REQUEST_RESET"}')
        polled = true
        $("#reset").html(lang_data['{{waiting_for_others}}'])
        return false
    }
    return true
}

function disconnect_room(reset=false,has_status=false){
    ws.close()
    $(document.getElementById("link_pos")).hide()
    try { document.getElementById(`guess_pos_1`).remove()} catch (error) {}
    try { document.getElementById(`guess_pos_2`).remove()} catch (error) {}
    try { document.getElementById(`guess_pos_3`).remove()} catch (error) {}
    try { document.getElementById(`guess_pos_4`).remove()} catch (error) {}
    $('.card_icon_guess').hide()
    clearInterval(ws_ping)
    if (!reset){
        $("#room_id_create").show()
        $("#room_id_link").show()
        $("#room_id_disconnect").hide()
        if(!has_status){
            document.getElementById("room_id_note").innerText = `${lang_data['{{status}}']}: ${lang_data['{{not_connected}}']}`
            document.getElementById("settings_status").className = null
            document.getElementById("room_id").value = ""
        }
        setCookie("room_id","",-1)
        setCookie("link-position","",1)
        hasLink=false
    }
}

// ── Journal WS send helpers ───────────────────────────────────────────────────

function send_timer(force_start = false, force_stop = false){
    if(hasLink){
        ws.send(`{"action":"TIMER","force_start":${force_start},"force_stop":${force_stop}}`)
    }
}

function send_cooldown_timer(force_start = false, force_stop = false){
    if(hasLink){
        ws.send(`{"action":"COOLDOWNTIMER","force_start":${force_start},"force_stop":${force_stop}}`)
    }
}

function send_hunt_timer(force_start = false, force_stop = false){
    if(hasLink){
        ws.send(`{"action":"HUNTTIMER","force_start":${force_start},"force_stop":${force_stop}}`)
    }
}

function send_sound_timer(force_start = false, force_stop = false){
    if(hasLink){
        ws.send(`{"action":"SOUNDTIMER","force_start":${force_start},"force_stop":${force_stop}}`)
    }
}

function send_guess(ghost){
    if(hasLink){
        ds_name  = Object.keys(data_user).length > 0 ? data_user['username'] : ""
        ds_image = Object.keys(data_user).length > 0 ? `${data_user['avatar']}` : ""
        ws.send(`{"action":"GUESS","pos":${my_pos},"ghost":"${ghost}","ds_name":"${ds_name}","ds_image":"${ds_image}"}`)
    }
}

function request_guess(){
    if(hasLink){
        ws.send(`{"action":"GUESSSTATE"}`)
    }
}

function send_ping(){
    if(hasLink){
        ws.send('{"action":"PING"}')
    }
}

function send_state() {
    if (hasLink && state_received && map_loaded){
        var outgoing_state = JSON.stringify({
            'evidence': state['evidence'],
            'speed': state['speed'],
            'los': state['los'],
            'sanity': state['sanity'],
            'ghosts': state['ghosts'],
            "map": state['map'],
            "map_size": state['map_size'],
            "prev_monkey_state": state['prev_monkey_state'],
            "coal": document.getElementById("coal-icon").classList.contains("coal-active") ? 1 : 0,
            "forest_minion": $("#forest-minion-mod").text() != '0' ? 1 : 0,
            "blood_moon": document.getElementById("blood-moon-icon").classList.contains("blood-moon-active") ? 1 : 0,
            'settings': {
                "num_evidences":document.getElementById("num_evidence").value,
                "dif_name":document.getElementById("num_evidence").options[document.getElementById("num_evidence").selectedIndex].text,
                "cust_num_evidences":document.getElementById("cust_num_evidence").value,
                "cust_hunt_length":document.getElementById("cust_hunt_length").value,
                "cust_starting_sanity": document.getElementById("cust_starting_sanity").value,
                "cust_sanity_pill_rest": document.getElementById("cust_sanity_pill_rest").value,
                "cust_sanity_drain": document.getElementById("cust_sanity_drain").value,
                "cust_lobby_type": document.getElementById("cust_lobby_type").value,
                "ghost_modifier":parseInt(document.getElementById("ghost_modifier_speed").value)
            }
        })
        ws.send(outgoing_state)
        send_ml_state()
    }
}

function send_ml_state(){
    if (hasLink){
        var ghost_list = [];
        for (const [key, value] of Object.entries(state['ghosts'])){
            if($(document.getElementById(key)).hasClass("hidden")){
                ghost_list.push(`${key}:-1:${bpm_list.includes(key)? 1 : bpm_los_list.includes(key) ? 2 : 0}`)
            }
            else{
                ghost_list.push(`${key}:${value}:${bpm_list.includes(key) ? 1 : bpm_los_list.includes(key) ? 2 : 0}`)
            }
        }
        ws.send(`{"action":"ML-GHOSTS","ghost":"${ghost_list}"}`)

        var evi_list = [];
        for (const [key, value] of Object.entries(state['evidence'])){
            evi_list.push(`${key}:${$(document.getElementById(key)).hasClass("block") ? -2 : $(document.getElementById(key).querySelector("#checkbox")).hasClass("faded") ? -1 : value}`)
        }
        ws.send(`{"action":"ML-EVIDENCE","evidences":"${evi_list}"}`)
    }
}

// ── Desktop-link stubs (Electron IPC where useful, no-op otherwise) ───────────

function open_maps() { closeAll(true,false);  showSideMenu('maps'); }
function open_wiki() { closeAll(false,true); showSideMenu('wiki'); }

function send_bpm_link()       {}
function send_ghost_data_link(){}
function send_ghost_tests_link(){}
function send_empty_data_link(){}
function send_modifier_link()  {}
function send_map_preload_link(){}
function send_cur_map_link()   {}
function send_ping_link()      {}
function send_data_link()      {}
function send_reset_link()     {}
function send_timer_link()     {}
function send_sanity_link()    {}
function send_ghost_link()     {}
function send_evidence_link()  {}
function send_ghosts_link()    {}

// ── Relay timer toggle from main process hotkey to WS room ─────────────────
if (window.electronAPI) {
  const TIMER_WS_ACTIONS = { smudge: 'TIMER', cooldown: 'COOLDOWNTIMER', hunt: 'HUNTTIMER' };
  window.electronAPI.onWsBroadcastTimer(({ id }) => {
    if (hasLink && ws && TIMER_WS_ACTIONS[id]) {
      ws.send(JSON.stringify({ action: TIMER_WS_ACTIONS[id] }));
    }
  });
}
