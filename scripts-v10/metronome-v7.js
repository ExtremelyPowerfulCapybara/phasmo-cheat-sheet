
loadSound('https://zero-network.net/phasmophobia/static/assets/footstep.mp3',0)
loadSound('https://zero-network.net/phasmophobia/static/assets/footstep_asphalt_2.mp3',1)
loadSound('https://zero-network.net/phasmophobia/static/assets/footstep_asphalt_3.mp3',1)
loadSound('https://zero-network.net/phasmophobia/static/assets/footstep_carpet_2.mp3',2)
loadSound('https://zero-network.net/phasmophobia/static/assets/footstep_carpet_3.mp3',2)
loadSound('https://zero-network.net/phasmophobia/static/assets/footstep_gravel.mp3',3)
loadSound('https://zero-network.net/phasmophobia/static/assets/footstep_gravel_2.mp3',3)
loadSound('https://zero-network.net/phasmophobia/static/assets/footstep_wood_2.mp3',4)
loadSound('https://zero-network.net/phasmophobia/static/assets/footstep_wood_3.mp3',4)
loadSound('https://zero-network.net/phasmophobia/static/assets/footstep_metal_stairs.mp3',5)
loadSound('https://zero-network.net/phasmophobia/static/assets/footstep_metal_stairs_2.mp3',5)
loadSound('https://zero-network.net/phasmophobia/static/assets/footstep_metal_stairs_3.mp3',5)
loadSound('https://zero-network.net/phasmophobia/static/assets/footstep_squishy.mp3',6)
loadSound('https://zero-network.net/phasmophobia/static/assets/footstep_squishy_2.mp3',6)
loadSound('https://zero-network.net/phasmophobia/static/assets/footstep_squishy_3.mp3',6)
loadSound('https://zero-network.net/phasmophobia/static/assets/footstep_krampus.mp3',7)
loadSound('https://zero-network.net/phasmophobia/static/assets/footstep_krampus_2.mp3',7)
loadSound('https://zero-network.net/phasmophobia/static/assets/footstep_krampus_3.mp3',7)
loadSound('https://zero-network.net/phasmophobia/static/assets/footstep_forest_spirit.mp3',8)
loadSound('https://zero-network.net/phasmophobia/static/assets/footstep_forest_spirit_2.mp3',8)
loadSound('https://zero-network.net/phasmophobia/static/assets/footstep_vinyl.mp3',9)
loadSound('https://zero-network.net/phasmophobia/static/assets/footstep_vinyl_2.mp3',9)
loadSound('https://zero-network.net/phasmophobia/static/assets/footstep_vinyl_3.mp3',9)
loadSound('assets/click.mp3',10)

var speed = 1.7
var muteTimerToggle = false
var muteTimerCountdown = false

var offset = 0
let forest_minion = 0
let blood_moon = 0
let coal = 0
var step_duration = 5 * 1000

var additional_ghost_data = ["deildegast","hantu","moroi","thaye"]
var additional_ghost_var = [0.18,0.085,0.175]

let em = (bm,fm,c) => (bm||c?1.15:1.0)*(1.0+(fm*0.1))

// Jinn 1.7 -> 1.5 (run,run,jump)

// 1 run -> 1.45m/s
// 1 jump -> 1.8m/s?
// 2 jump ->

let speedToBpm = {
    0:(x,bm,fm,c) => 60/((1/(x*0.5*em(bm,fm,c)))-0.075),
    1:(x,bm,fm,c) => 60/((1/(x*0.75*em(bm,fm,c)))-0.075),
    2:(x,bm,fm,c) => 60/((1/(x*1.0*em(bm,fm,c)))-0.075),
    3:(x,bm,fm,c) => 60/((1/(x*1.25*em(bm,fm,c)))-0.075),
    4:(x,bm,fm,c) => 60/((1/(x*1.5*em(bm,fm,c)))-0.075)
}

let bpmToSpeed = {
    0:(x,bm,fm,c) => x/(0.5*em(bm,fm,c)*(60+x*0.075)),
    1:(x,bm,fm,c) => x/(0.75*em(bm,fm,c)*(60+x*0.075)),
    2:(x,bm,fm,c) => x/(1.0*em(bm,fm,c)*(60+x*0.075)),
    3:(x,bm,fm,c) => x/(1.25*em(bm,fm,c)*(60+x*0.075)),
    4:(x,bm,fm,c) => x/(1.5*em(bm,fm,c)*(60+x*0.075))
};

let bpmToSpeedTest = (x,mm) => x/(1.0*mm*(60+x*0.075));


var last_id = "";

function mute(type){
    if(type == "toggle"){
        muteTimerToggle = document.getElementById("mute_timer_toggle").checked
    }
    if(type == "countdown"){
        muteTimerCountdown = document.getElementById("mute_timer_countdown").checked
    }
}

function setSoundType(){
    snd_choice = document.getElementById("modifier_sound_type").value;
    prev_r = 0
    step_cnt = 0
}

function setTempo(){
    var speed_idx = parseInt($("#ghost_modifier_speed").val())
    tempo = speedToBpm[speed_idx](speed,blood_moon,forest_minion,coal) * (1+(offset/100))
}

function setVolume(){
    volume = $("#modifier_volume").val()/100
}

function adjustOffset(v){
    var cur_offset = document.getElementById("offset_value").innerText
    offset = parseFloat(cur_offset.replace(/\d+(?:-\d+)+/g,"")) + parseFloat(v)
    offset = offset > 15 ? 15 : offset < -15 ? -15 : offset;
    document.getElementById("offset_value").innerText = ` ${offset.toFixed(1)}% `
}

function toggleSound(set_tempo,id){
    adjustOffset(0)
    speed = set_tempo
    var speed_idx = parseInt($("#ghost_modifier_speed").val())
    tempo = speedToBpm[speed_idx](speed,blood_moon,forest_minion,coal) * (1+(offset/100))
    if(!isPlaying){
        step()
        timerStop = setTimeout(function(){
            if(isPlaying){
                isPlaying = !isPlaying;
                window.clearTimeout(timerID);
            }
        },step_duration)
    }
    else if(last_id == id){
        step()
    }
    else{
        window.clearTimeout(timerStop)
        timerStop = setTimeout(function(){
            if(isPlaying){
                isPlaying = !isPlaying;
                window.clearTimeout(timerID);
            }
        },step_duration)
    }
    last_id = id
}

function simulate_los(set_tempo,append_speed,id){
    adjustOffset(0)
    speed = set_tempo
    var speed_idx = parseInt($("#ghost_modifier_speed").val())
    tempo = speedToBpm[speed_idx](speed+append_speed,blood_moon,forest_minion,coal) * (1+(offset/100))
    var progress_bar = $('#losProgressBar')
    var progress_bar_inner = document.getElementById('losProgressBarInner')

    if(!isPlaying){
        step()
        var los_speed = speed * 1.65
        var los_tempo = speedToBpm[speed_idx](los_speed+append_speed,blood_moon,forest_minion,coal) * (1+(offset/100))
        var increase_steps_start = 4
        var increase_steps_end = id.includes("aswang") ? 21 : 30
        var increase_steps_total = id.includes("aswang") ? 25 : 34
        document.getElementsByClassName("los_start_line")[0].style.left = `${increase_steps_start/increase_steps_total*100}%`
        document.getElementsByClassName("los_start_label")[0].style.left = `calc(${increase_steps_start/increase_steps_total*100}% - 30px)`
        document.getElementsByClassName("los_end_line")[0].style.left = `${100 - (increase_steps_start/increase_steps_total*100)}%`
        document.getElementsByClassName("los_end_label")[0].style.left = `calc(${100 - (increase_steps_start/increase_steps_total*100)}% - 30px)`
        var step_increase = (los_tempo - tempo) / (increase_steps_end - increase_steps_start)
        var current_step = 0
        timerStop = setTimeout(function increaseSpeed(){
            if(isPlaying){
                current_step++

                var progressBarWidth = current_step * progress_bar.width() / increase_steps_total + "px";
                progress_bar_inner.style.width = progressBarWidth;

                if(current_step < increase_steps_start){
                    timerID = setTimeout(increaseSpeed,500)
                }

                else if(current_step < increase_steps_end){
                    tempo += step_increase
                    timerID = setTimeout(increaseSpeed,500)
                }

                else if(current_step < increase_steps_total){
                    tempo = los_tempo
                    timerID = setTimeout(increaseSpeed,500)
                }

                else{
                    tempo = los_tempo
                    timerStop = setTimeout(function(){
                        if(isPlaying){
                            isPlaying = !isPlaying;
                            window.clearTimeout(timerID);
                        }
                    },500)
                }
            }
        },500)
    }
    else if(last_id == id){
        step()
    }
    else{
        window.clearTimeout(timerStop)
        timerStop = setTimeout(function(){
            if(isPlaying){
                isPlaying = !isPlaying;
                window.clearTimeout(timerID);
            }
        },step_duration)
    }
    last_id = id
}

// BPM finder removed. Stubs keep global references intact.

// bpm_list and bpm_los_list are declared with `let` in filter-v15.js — do not redeclare here.
var bpm_speeds   = new Set();

function bpm_clear() {
    // Reset box shadows; bpm_list/bpm_los_list are managed by filter-v15.js
    var ghosts = document.getElementsByClassName("ghost_card");
    for (var i = 0; i < ghosts.length; i++) { ghosts[i].style.boxShadow = 'none'; }
}
function bpm_tap()           {}
function bpm_calc()          {}
function mark_ghosts()       {}
function mark_ghost_details(){}
