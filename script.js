marked.use(markedAlert());
marked.use(markedHighlight.markedHighlight({
  emptyLangClass: "hljs",
  langPrefix: "hljs language-",
  highlight(code, lang, info) {
    const language = hljs.getLanguage(lang) ? lang : "plaintext";
    return hljs.highlight(code, { language }).value;
  }
}));

const repo = {};
window.onhashchange = (e) => {
  const params = new URLSearchParams(location.hash.replace("#", ""));

  if (!params.has("repo")) {
    params.set("repo", "https://ipfs.io/ipns/k51qzi5uqu5dly54t5zpzvguulvaq16fdxn75t8icsoeyprjtu4ixg1dte14yn");
  }
  params.set("repo", params.get("repo").replace(/\/+$/, ""));
  document.getElementById("repo-url").value = params.get("repo");

  if (e?.type == "hashchange") {
    document.getElementById("ref").value = params.get("ref");
  }

  if (location.hash != ("#" + params.toString())) {
    history.replaceState({}, "", "#" + params.toString());
  }

  if (params.get("repo") != repo.url) {
    document.getElementById("latest-author").textContent = "Loading...";
    document.getElementById("latest-message").innerHTML = "";
    document.getElementById("commit-hash").innerHTML = "";
    document.getElementById("filelist").innerHTML = "";
    document.getElementById("file-card").classList.add("d-none");
    repo.url = params.get("repo");
    repo.refs = fetch(repo.url + "/info/refs")
      .then((x) => x.text())
      .then((x) => {
        const refs = {};
        for (const line of x.split("\n")) {
          const [hash, name] = line.split("\t");
          if (name) {
            refs[name.trim()] = hash;
          }
        }
        return refs;
      });
    repo.default_ref = fetch(repo.url + "/HEAD")
      .then((x) => x.text())
      .then((x) => x.substr(5).trim());
    if (repo.default_ref instanceof Promise || repo.refs instanceof Promise) {
      Promise.all([repo.default_ref, repo.refs]).then(([default_ref, refs]) => {
        repo.default_ref = default_ref;
        repo.refs = refs;
        document.getElementById("refs-datalist").innerHTML = "";
        for (const [name, hash] of Object.entries(repo.refs)) {
          const option = document.createElement("option");
          option.value = name;
          option.textContent = name;
          if (repo.default_ref == name) {
            option.textContent += " (default)";
          }
          document.getElementById("refs-datalist").appendChild(option);
        }
        window.onhashchange();
      }).catch(e => {
        document.getElementById("latest-author").textContent = e;
      });
    }
  }
  let ref_commit_hash = params.get("ref")?.length == 40 ? params.get("ref") : undefined;
  repo.commit_hash = params.get("commit");
  if (!(repo.default_ref instanceof Promise) && !(repo.refs instanceof Promise)) {
    if (!ref_commit_hash) {
      ref_commit_hash = repo.refs[params.get("ref")] ?? repo.refs[repo.default_ref];
    }
    if (!repo.commit_hash) {
      repo.commit_hash = ref_commit_hash;
    }
  }
  if (repo.commit_hash) {
    document.getElementById("commit-hash").textContent = repo.commit_hash;
    document.getElementById("prev-btn").classList.add("d-none");
    document.getElementById("diff-btn").classList.add("d-none");

    document.getElementById("next-btn").classList.add("d-none");
    if (ref_commit_hash != repo.commit_hash && ref_commit_hash) {
      let path_obj = getRawObject(ref_commit_hash);
      while (path_obj && !(path_obj instanceof Promise) && parseCommit(path_obj).parent != repo.commit_hash) {
        ref_commit_hash = parseCommit(path_obj).parent;
        path_obj = getRawObject(ref_commit_hash);
      }
      if (path_obj instanceof Promise) {
        path_obj.then(window.onhashchange);
      }
      else {
        repo.next_commit = ref_commit_hash;
        document.getElementById("next-btn").classList.remove("d-none");
      }
    }

    let obj = getRawObject(repo.commit_hash);
    if (obj instanceof Promise) {
      document.getElementById("latest-author").textContent = "Loading...";
      document.getElementById("latest-message").innerHTML = "";
      document.getElementById("commit-header").classList.add("border-bottom-0");
      document.getElementById("full-message").classList.add("d-none");
      document.getElementById("filelist").innerHTML = "";
      document.getElementById("file-card").classList.add("d-none");
      obj.then(window.onhashchange);
    }
    else {
      const commit = parseCommit(obj);
      document.getElementById("latest-author").textContent = commit.author.split("<")[0].trim();
      document.getElementById("latest-message").textContent = commit.message.split("\n")[0].trim();
      const isMultiline = (commit.message.indexOf("\n") != -1);
      if (isMultiline) {
        document.getElementById("expand-btn").classList.remove("d-none");
      }
      else {
        document.getElementById("expand-btn").classList.add("d-none");
      }
      if (isMultiline && window.fullmsg) {
        document.getElementById("commit-header").classList.remove("border-bottom-0");
        document.getElementById("full-message").classList.remove("d-none");
        document.getElementById("full-message").textContent = commit.message.split("\n").slice(1).join("\n").trim();
      }
      else {
        document.getElementById("commit-header").classList.add("border-bottom-0");
        document.getElementById("full-message").classList.add("d-none");
      }

      if (commit.parent) {
        repo.prev_commit = commit.parent;
        document.getElementById("prev-btn").classList.remove("d-none");
        document.getElementById("diff-btn").classList.remove("d-none");
      }

      const tree_hash = parseCommit(obj).tree;
      obj = getRawObject(tree_hash);
      if (obj instanceof Promise) {
        obj.then(window.onhashchange);
      }
      else {
        if (params.has("diff")) {
          document.getElementById("diff-btn").textContent = "Files";
          document.getElementById("file-view").classList.add("d-none");
          document.getElementById("diff-view").classList.remove("d-none");
          document.getElementById("diff-view").innerHTML = "";
          const oldCommit = getRawObject(params.get("diff"));
          if (oldCommit instanceof Promise) {
            oldCommit.then(window.onhashchange);
          }
          else {
            const diffdata = { "": { mode: "40000", new: tree_hash, old: parseCommit(oldCommit).tree } };
            let pending, updated;
            do {
              updated = false;
              for (const [name, entry] of Object.entries(diffdata)) {
                if (entry.new != entry.old) {
                  const newObj = entry.new ? getRawObject(entry.new) : undefined;
                  const oldObj = entry.old ? getRawObject(entry.old) : undefined;
                  if (newObj instanceof Promise) {
                    newObj.then(window.onhashchange);
                    pending = true;
                    break;
                  }
                  if (oldObj instanceof Promise) {
                    oldObj.then(window.onhashchange);
                    pending = true;
                    break;
                  }
                  if (entry.mode == "40000") {
                    const base_path = name ? name + "/" : "";
                    if (newObj) {
                      for (const entry of parseTree(newObj)) {
                        if (!((base_path + entry.name) in diffdata)) {
                          diffdata[base_path + entry.name] = { mode: entry.mode };
                          updated = true;
                        }
                        diffdata[base_path + entry.name].new = entry.hash;
                      }
                    }
                    if (oldObj) {
                      for (const entry of parseTree(oldObj)) {
                        if (!((base_path + entry.name) in diffdata)) {
                          diffdata[base_path + entry.name] = { mode: entry.mode };
                          updated = true;
                        }
                        diffdata[base_path + entry.name].old = entry.hash;
                      }
                    }
                  }
                }
              }
            } while (updated && !pending);
            if (!pending) {
              for (const [name, entry] of Object.entries(diffdata)) {
                if (entry.mode != "40000" && entry.old != entry.new) {
                  const card = document.createElement("div");
                  card.className = "card mb-3";
                  {
                    const cardHeader = document.createElement("div");
                    cardHeader.className = "card-header";
                    cardHeader.textContent = name;
                    card.appendChild(cardHeader);
                  }
                  {
                    const arr = name.split(".");
                    const language = arr[arr.length - 1];
                    const pre = document.createElement("pre");
                    pre.className = "m-3";
                    pre.innerHTML = hljs.highlight(Diff.createPatch("", entry.old ? parseBlob(getRawObject(entry.old)) : "", entry.new ? parseBlob(getRawObject(entry.new)) : "").split("\n").slice(4).join("\n"), { language: hljs.getLanguage(language) ? language: "plaintext" }).value.split("<span class=\"").join("<div class=\"d-inline ").split("</span>").join("</div>").split("\n").map(line => {
                      if (line.startsWith("+")) {
                        return `<span class="diff-add">${line}</span>`;
                      }
                      if (line.startsWith("-")) {
                        return `<span class="diff-sub">${line}</span>`;
                      }
                      if (line.startsWith("@@ ")) {
                        return `<span class="hljs-meta">${line.replace(/<div class="[^"]+">([^<]*)<\/div>/g, "$1")}</span>`;
                      }
                      if (line.startsWith("\\ ")) {
                        return line.replace(/<div class="[^"]+">([^<]*)<\/div>/g, "$1");
                      }
                      return line;
                    }).join("\n");
                    card.appendChild(pre);
                  }
                  document.getElementById("diff-view").appendChild(card);
                }
              }
            }
          }
        }
        else {
          document.getElementById("diff-btn").textContent = "Diff";
          document.getElementById("file-view").classList.remove("d-none");
          document.getElementById("diff-view").classList.add("d-none");

          const choices = (params.get("path") ?? "").split("/");
          let base_path = "";
          let file;
          for (const choice of choices) {
            if (!choice) {
              continue;
            }
            const entry = parseTree(obj).find(x => x.name == choice);
            if (!entry) {
              params.set("path", "");
              history.replaceState({}, "", "#" + params.toString());
              window.onhashchange();
              return;
            }
            if (entry.mode != "40000") {
              file = entry;
              break;
            }
            base_path += entry.name + "/";
            obj = getRawObject(entry.hash);
            if (obj instanceof Promise) {
              document.getElementById("filelist").innerHTML = "";
              document.getElementById("file-card").classList.add("d-none");
              obj.then(window.onhashchange);
              break;
            }
          }
          if (!(obj instanceof Promise)) {
            const files = parseTree(obj);
            checkoutTree(files, base_path);
            if (!file) {
              file = files.find(x => x.name == "README.md");
            }
            if (file) {
              document.getElementById("file-card").classList.remove("d-none");
              document.getElementById("file-name").textContent = file.name;
              document.getElementById("file-hash").textContent = file.hash;
              obj = getRawObject(file.hash);

              const arr = file.name.split(".");
              const language = arr[arr.length - 1];
              const parsable = (language == "md") && !(obj instanceof Promise);
              const showRaw = !parsable || window.mdraw;
              if (parsable) {
                document.getElementById("raw-span").classList.remove("d-none");
              }
              else {
                document.getElementById("raw-span").classList.add("d-none");
              }
              if (showRaw) {
                document.querySelector("#raw-span a").textContent = "Parsed";
                document.getElementById("file-data").classList.remove("d-none");
                document.getElementById("file-contents").classList.add("d-none");
              }
              else {
                document.querySelector("#raw-span a").textContent = "Raw";
                document.getElementById("file-data").classList.add("d-none");
                document.getElementById("file-contents").classList.remove("d-none");
              }

              if (obj instanceof Promise) {
                document.getElementById("file-data").textContent = "Loading...";
                obj.then(window.onhashchange);
              }
              else if (showRaw) {
                document.getElementById("file-data").innerHTML = hljs.highlight(parseBlob(obj), { language: hljs.getLanguage(language) ? language: "plaintext" }).value;
              }
              else {
                document.getElementById("file-contents").innerHTML = marked.parse(parseBlob(obj));
              }
            }
            else {
              document.getElementById("file-card").classList.add("d-none");
            }
          }
        }
      }
    }
  }
};

document.getElementById("repo-url").onchange = () => {
  location.hash = "repo=" + encodeURIComponent(document.getElementById("repo-url").value);
};

document.getElementById("ref").onchange = () => {
  location.hash = "repo=" + encodeURIComponent(document.getElementById("repo-url").value) + "&ref=" + document.getElementById("ref").value;
};

document.getElementById("next-btn").onclick = () => {
  location.hash = "repo=" + encodeURIComponent(document.getElementById("repo-url").value) + "&ref=" + document.getElementById("ref").value + "&commit=" + repo.next_commit;
};

document.getElementById("prev-btn").onclick = () => {
  location.hash = "repo=" + encodeURIComponent(document.getElementById("repo-url").value) + "&ref=" + document.getElementById("ref").value + "&commit=" + repo.prev_commit;
};

document.getElementById("diff-btn").onclick = () => {
  let hash = "repo=" + encodeURIComponent(document.getElementById("repo-url").value) + "&ref=" + document.getElementById("ref").value + "&commit=" + repo.commit_hash;
  if (document.getElementById("diff-btn").textContent == "Diff") {
    hash += "&diff=" + repo.prev_commit;
  }
  location.hash = hash; 
};

const rawObjects = {};
const pendingObjects = {};
function getRawObject(hash) {
  if (hash in rawObjects) {
    return rawObjects[hash];
  }
  if (!(hash in pendingObjects)) {
    pendingObjects[hash] = (async () => {
      const response = await fetch(
        repo.url + "/objects/" + hash.substr(0, 2) + "/" + hash.substr(2),
      );
      rawObjects[hash] = new Uint8Array(
        await new Response(
          response.body.pipeThrough(new DecompressionStream("deflate")),
        ).arrayBuffer(),
      );
      delete pendingObjects[hash];
      document.getElementById("status-text").innerHTML = Object.keys(pendingObjects).length ? "Downloading " + Object.keys(pendingObjects).map(x => "<code>" + x + "</code>").join(", ") + "..." : "";
      return rawObjects[hash];
    })();
    document.getElementById("status-text").innerHTML = "Downloading " + Object.keys(pendingObjects).map(x => "<code>" + x + "</code>").join(", ") + "...";
  }
  return pendingObjects[hash];
}

function checkoutTree(tree, base_path) {
  document.getElementById("filelist").innerHTML = "";

  if (base_path) {
    const tr = document.createElement("tr");
    {
      const td = document.createElement("td");
      {
        const a = document.createElement("a");
        const arr = base_path.split("/");
        arr.pop();
        arr.pop();
        a.href = "#repo=" + encodeURIComponent(repo.url) + "&ref=" + document.getElementById("ref").value + "&commit=" + repo.commit_hash + "&path=" + encodeURIComponent(arr.join("/"));
        a.textContent = "..";
        td.appendChild(a);
      }
      tr.appendChild(td);
    }
    document.getElementById("filelist").appendChild(tr);
  }

  for (const file of tree) {
    const tr = document.createElement("tr");
    {
      const td = document.createElement("td");
      {
        const a = document.createElement("a");
        a.href = "#repo=" + encodeURIComponent(repo.url) + "&ref=" + document.getElementById("ref").value + "&commit=" + repo.commit_hash + "&path=" + encodeURIComponent(base_path + file.name);
        a.textContent = file.name;
        if (file.mode == "40000") {
          a.textContent += "/";
        }
        td.appendChild(a);
      }
      tr.appendChild(td);
    }
    document.getElementById("filelist").appendChild(tr);
  }
}

window.onhashchange();

let downloadPending = false;
document.getElementById("dl-btn").onclick = async () => {
  if (downloadPending) {
    return;
  }
  downloadPending = true;
  const commit_hash = repo.commit_hash;
  const tree = await getRawObject(parseCommit(await getRawObject(commit_hash)).tree);
  const files = [];
  await collectFilesForZip(files, tree, "");
  await zipDownload(commit_hash + ".zip", files);
  downloadPending = false;
}
async function collectFilesForZip(files, tree, base_path) {
  for (const file of parseTree(tree)) {
    if (file.mode == "40000") {
      const subtree = await getRawObject(file.hash);
      await collectFilesForZip(files, subtree, base_path + file.name + "/");
    }
    else {
      const blob = await getRawObject(file.hash);
      files.push([ base_path + file.name, parseBlob(blob) ]);
    }
  }
}
