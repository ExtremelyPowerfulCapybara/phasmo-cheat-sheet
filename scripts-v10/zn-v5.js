function getCookie(e){let t=e+"=",i=decodeURIComponent(document.cookie).split(";");for(let n=0;n<i.length;n++){let o=i[n];for(;" "==o.charAt(0);)o=o.substring(1);if(0==o.indexOf(t))return o.substring(t.length,o.length)}return""}
function setCookie(e,t,i){let n=new Date;n.setTime(n.getTime()+864e5*i);let o="expires="+n.toUTCString();document.cookie=e+"="+t+";"+o+";path=/"}

let openSearchTab = false
let ghost_version = null

function setLoading(percent) {
    const bar = document.getElementById("loading-bar");
    percent = Math.max(0, Math.min(100, percent));
    bar.style.width = percent + "%";
}

function checkLink(){
    return new Promise((resolve, reject) => {
        params = new URL(window.location.href).searchParams

        if (params.get('journal')){
            setCookie("room_id",params.get('journal'),1)
            window.location.href = window.location.href.split("?")[0]
        }

        if (params.get("search")){
            openSearchTab = true
        }

        if (params.get("version")){
            ghost_version = params.get('version')
        }

        resolve("URL parsed")
    })
}

function heartbeat(){ /* removed — analytics/active-users not needed */ }

function loadAllAndConnect(){
    let loadZN = new Promise((resolve) => {
        // Generate session ID locally — no remote call needed
        function genLocalId() {
            var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
            var id = 'local_';
            for (var i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
            return id;
        }
        znid = getCookie("znid") || genLocalId();
        setCookie("znid", znid, 1);
        var pznid = getCookie("prev-znid");
        $("#session").text(`C: ${znid}`)
        $("#prev-session").text(`P: ${pznid == '' ? '-' : pznid}`)
        $('#room_id').val("")
        $('#room_id').css('color',"#CCC")
        $('#room_id').prop('disabled',false)
        $('#room_id_create').show()
        $('#room_id_link').show()
        resolve("Local session ready")
    })

    let loadData = new Promise((resolve, reject) => {

        lang = getCookie("lang")

        if(!lang){
            lang = 'en'
        }
        try{
            fetch(`/phasmophobia/data/ghosts.json`, {cache: 'default', signal: AbortSignal.timeout(10000)})
            .then(data => data.json())
            .then(data => {

                all_ghosts = Object.fromEntries(data.ghosts.map(a => [a.ghost,a.name]))
                all_evidence = data.evidence

                var cards = document.getElementById('cards')
                var wiki = document.getElementById('wiki-0-evidence-data')
                var cur_version = document.getElementById('current-version-label')
                var evidence_list = document.getElementById('evidence')
        
                evidence_list.innerHTML = "";
                Object.entries(data.evidence).forEach(([key,value]) => {
                    evidence_list.innerHTML += `
                    <div class="evidence-row">
                        <img class="monkey-smudge" style="display:none;" src="imgs/smudge.png">
                        <button id="${key}" class="tricheck white" name="evidence" onclick="tristate(this)" value="${key}">
                            <div id="checkbox" class="neutral"><span class="icon"></span></div>
                            <div class="label">${value}</div>
                        </button>
                        <img class="monkey-paw-select" src="imgs/paw-icon.png" onclick="monkeyPawFilter(this)">
                    </div>
                    `
                })
        
                cards.innerHTML = "<div id='control_hints'>{{tap_int}}<br>{{dbl_tap_int}}</div><div id='all_control' class='all_control'><div id='expand_all' onclick='expandAll()'>{{expand_all}}</div><div id='collapse_all' onclick='collapseAll()'>{{collapse_all}}</div></div>";
                wiki.innerHTML = "";
                for(var i = 0; i < data.ghosts.length; i++){
                    bpm_speeds.add(data.ghosts[i].min_speed)
                    if(data.ghosts[i].max_speed != null){bpm_speeds.add(data.ghosts[i].max_speed)}
                    if(data.ghosts[i].alt_speed != null){bpm_speeds.add(data.ghosts[i].alt_speed)}
                    var ghost = new Ghost(data.ghosts[i],data.evidence);
                    cards.innerHTML += `${ghost.ghostTemplate}`
                    wiki.innerHTML += (i == data.ghosts.length-1 ? `${ghost.wikiTemplate.replace("&#9500;","&#9492;")}` : `${ghost.wikiTemplate}`)
                }
                cur_version.innerHTML = `${data.version}`
            })
            .then(data => {
                var raw_state = getCookie("state")

                if (!raw_state || raw_state == '' || raw_state == null){
                    console.log("No State found")
                    for (var i = 0; i < Object.keys(all_evidence).length; i++){
                        state["evidence"][Object.keys(all_evidence)[i]] = 0
                    }
                    for (var i = 0; i < Object.keys(all_ghosts).length; i++){
                        state["ghosts"][Object.keys(all_ghosts)[i]] = 1
                    }
                    state["prev_monkey_state"] = 0

                    var read_state = JSON.parse(JSON.stringify(state))
                }
                else{
                    var read_state = JSON.parse(raw_state)
                }

                for (const [key, value] of Object.entries(read_state["evidence"])){ 
                    if($(document.getElementById(key)).parent().find(".monkey-paw-select").hasClass("monkey-paw-selected"))
                        monkeyPawFilter($(document.getElementById(key)).parent().find(".monkey-paw-select"))

                    if (value == 1){
                        tristate(document.getElementById(key));
                    }
                    else if (value == -1){
                        tristate(document.getElementById(key));
                        tristate(document.getElementById(key));
                    }
                    else if (value == -2){
                        monkeyPawFilter($(document.getElementById(key)).parent().find(".monkey-paw-select"))
                    }
                }
                for (const [key, value] of Object.entries(read_state["speed"])){ 
                    if (value == 1){
                        $("#"+key)[0].click();
                    }
                }
                for (const [key, value] of Object.entries(read_state["sanity"])){ 
                    if (value == 1){
                        $("#"+key)[0].click();
                    }
                }
                prev_monkey_state = read_state["prev_monkey_state"] ?? 0

                if (state['los'] == 1){
                    tristate(document.getElementById("LOS"));
                }
                else if (state['los'] == 0){
                    tristate(document.getElementById("LOS"));
                    tristate(document.getElementById("LOS"));
                }

                for (const [key, value] of Object.entries(read_state['ghosts'])){ 
                    if (value == 0){
                        fade(document.getElementById(key), true);
                    }
                    else if (value == -2){
                        died(document.getElementById(key), true, true);
                    }
                    else if (value == -1){
                        remove(document.getElementById(key), true, true);
                    }
                    else if (value == 2){
                        select(document.getElementById(key), true, true);
                    }
                    else if (value == 3){
                        guess(document.getElementById(key), true, true);
                    }
                    else{
                        state['ghosts'][key] = value
                    }
                }
            })
            .then(() => {
                let mquery = window.matchMedia("screen and (pointer: coarse) and (max-device-width: 600px)")
                if(mquery.matches){
                    $("#menu").show()
                    setTimeout(() => {
                        updateScaling()
                        $("#control_hints")[0].scrollIntoView({behavior: "smooth"})
                    }, 1000)
                }
                resolve("Ghost data loaded")
            })
            .catch(error => {
                console.error(error)
                document.getElementById("page-loading-status").innerText = "failed to load ghost data!"
                reject("Could not load ghost data")
            })
        }
        catch{
            document.getElementById("page-loading-status").innerText = "failed to load ghost data!"
            reject("Could not load ghost data")
        }
    })

    let loadMaps = new Promise((resolve, reject) => {
        fetch("/phasmophobia/data/maps", {cache: 'default', signal: AbortSignal.timeout(12000)})
        .then(data => data.json())
        .then(data => {
            var map_html = ""
            var usr_set = {}
            try{
                let cur_settings = getCookie("settings")
                usr_set = JSON.parse(cur_settings)
            }
            catch(e){
                console.warn(`Error loading settings! Loading defaults...`)
                usr_set = user_settings
            }
            
            var usr_map = usr_set.hasOwnProperty('map') ? usr_set['map'] == "6 Tanglewood Drive" ? "tanglewood" : usr_set['map']: "tanglewood"

            for(var i = 0; i < data.length; i++) {
                all_maps[data[i]['div_id']] = data[i]['file_url']
                if(data[i]['event_url'])
                    all_maps[`${data[i]['div_id']}-e`] = data[i]['event_url']
                map_html += `<button class="maps_button${data[i]['div_id'] == usr_map ? " selected_map" : ""}" id="${data[i]['div_id']}" onclick="changeMap(this,'${data[i]['file_url']}');send_cur_map_link();saveSettings();"><div class="map_size ${data[i]['size'].toLowerCase()}">${data[i]['size']}</div>${data[i]['name']}${data[i]['event_url'] ? '<div class="event_map">★</div>' : ''}</button>`
            }
            $("#maps_list").html(map_html)

            resolve("Map data loaded")
        })
        .catch(error => {
            console.error(error)
            document.getElementById("page-loading-status").innerText = "failed to load map data!"
            reject("Failed to load map data")
        })

    })

    let loadWeekly = new Promise((resolve, reject) => {
        fetch("/phasmophobia/data/weekly.json", {cache: 'default', signal: AbortSignal.timeout(10000)})
        .then(data => data.json())
        .then(data => {
            weekly_data = {
                "title": data.challenge,
                "description": data.description,
                "map": data.map,
                "map_id": data.map_id,
                "player_speed": data.details.player_speed,
                "ghost_speed": data.details.ghost_speed,
                "num_evidence": data.details.num_evidence,
                "hunt_duration": data.details.cssettings.hunt_duration,
                "sanity_drain_speed": data.details.cssettings.sanity_drain_speed,
                "sanity_pill_restoration": data.details.cssettings.sanity_pill_restoration,
                "starting_sanity": data.details.cssettings.starting_sanity,
                "equipment_url": data.equipment_url,
                "cursed_objects": data.details.cursed_objects,
                "friendly_ghost": data.details.friendly_ghost,
                "difficulty_id": data.difficulty_id
            }

            let image_str = weekly_data.equipment_url !== null ?  `<img class="weekly-image" loading="lazy" src="${weekly_data.equipment_url}">` : "<h4>{{weekly_missing_image}}</h4>"

            let weekly_html = `
                <h1>${weekly_data.title}</h1>
                <h4 style="margin-top:0px;"><i>${weekly_data.description}</i></h4>
                <hr>
                <div class="weekly-modifiers">
                    <div class="weekly-mod"><b>{{weekly_map}}</b>${weekly_data.map}</div>
                    <div class="weekly-mod"><b>{{weekly_player_speed}}</b>${weekly_data.player_speed}%</div>
                    <div class="weekly-mod"><b>{{weekly_ghost_speed}}</b>${weekly_data.ghost_speed}%</div>   
                    <div class="weekly-mod"><b>{{weekly_num_evidence}}</b>${weekly_data.num_evidence}</div>
                    <div class="weekly-mod"><b>{{weekly_cursed_possessions}}</b>${weekly_data.cursed_objects.join(', ')}</div>
                    <div class="weekly-mod"><b>{{weekly_friendly_ghost}}</b>${weekly_data.friendly_ghost}</div>
                </div>
                ${image_str}
            `

            document.getElementById("weekly_title").innerText += ` (${getCurrentWeekUTC()})`
            document.getElementById("weekly_info_box").innerHTML = weekly_html
            document.getElementById("weekly_footer").innerHTML = `<b>{{weekly_difficulty_settings}}</b>: <a href="https://zero-network.net/phasmo-cheat-sheet/difficulty-builder/?share=${weekly_data.difficulty_id}" target="_blank">${weekly_data.difficulty_id}</a>`

            resolve("Weekly data loaded")
        })
        .catch(error => {
            console.error(error)
            reject("Failed to load weekly data")
        })
    })

    // Language selection removed — English only
    let loadLanguages = Promise.resolve("English only")
    setLoading(25)
    document.getElementById("page-loading-status").innerText = "loading language data..."
    Promise.all([load_translation()])
    .then(() => {
        setLoading(40)
        document.getElementById("page-loading-status").innerText = "loading ghost & map data..."
        Promise.all([loadZN,loadData,loadMaps,loadWeekly,loadLanguages])
        .then(() => {
            setLoading(80)
            document.getElementById("page-loading-status").innerText = "translating page..."
            Promise.all([translate(lang)])
            .then(() => {
                Promise.all([fallback_translate(lang)])
                .then(() => {
                    setLoading(90)
                    document.getElementById("page-loading-status").innerText = "translating wiki..."
                    Promise.all([translate_wiki(lang)])
                    .then(() => {
                        Promise.all([fallback_translate_wiki(lang)])
                        .then(() => {
                            setLoading(99)
                            document.getElementById("page-loading-status").innerText = "loading user settings..."
                            Promise.all([getLink()])
                            .then(() => {
                                setLoading(100)
                                loadSettings()
                                filter(true)
                                applyPerms()
                                auto_link()
                                openWikiFromURL()
                                loadSearch()
                            })
                        })
                    })
                })
            })
        })
        .catch(e => {
            // Maintenance Block
            $("#maintenance-block").fadeIn(1000)
        })
    })
}

function loadSearch(){
    mquery = window.matchMedia("screen and (pointer: coarse) and (max-device-width: 600px)")
    params = new URL(window.location.href).searchParams
    if(!mquery.matches && openSearchTab){
        document.getElementById("search_bar").value = params.get("search")
        showSearch()
        search()
        let url = new URL(window.location.href)
        url.searchParams.delete("search")
        history.replaceState(history.state,"",url.href)
    }
}


function copy_user_settings(){
    var copyText = JSON.stringify(user_settings)
    ZNCopyShare(copyText,"Copy User Settings")
    document.getElementById("debug-console").value += "User Settings copied to clipboard\n"
}


function force_reload(){
    const url = new URL(location.href);
    url.searchParams.set("refresh", "1");
    location.href = url.toString();
}

// ── Stubs for removed module (login-v1.js) ────────────────────────────────────
// data_user is declared in wslink-v8.js
function getLink()    { return Promise.resolve(); }
function applyPerms() {}

