gcb()     {
    if [[ -n "$1" ]]; then
        branchname="${1}-$(printf '%04x' "$(od -An -N2 -tu2 /dev/urandom)")"
    else
        branchname="$(wordid)"
    fi
    git checkout -b "$branchname" 2>/dev/null
}

wordid()  {
        local words=/usr/share/dict/words
        printf '%s-%s-%s\n' \
                "$(shuf -n1 "$words" | tr -d "'" | tr '[:upper:]' '[:lower:]')" \
                "$(shuf -n1 "$words" | tr -d "'" | tr '[:upper:]' '[:lower:]')" \
                "$(shuf -n1 "$words" | tr -d "'" | tr '[:upper:]' '[:lower:]')"
}
