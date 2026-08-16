# Nono - A Rust-based Sandbox for NAC


# install nono
```
brew install nono
```

# setup nono
```
nono setup
```

# add nac-web nono profile
```
# copy the profile from this repo into your nono/profiles dir
cp ./docs/sandboxing/nac-web.json ~/.config/nono/profiles/nac-web.json 

# cp ~/.config/nono/profiles/nac-web.json ./docs/sandboxing/nac-web.json
# ln -sf ./docs/sandboxing/nac-web.json ~/.config/nono/profiles/nac-web.json 
```

# Run nac with your nono profile
```
nono run -vv --profile nac-web -- ~/bin/nac-web
```

Alternatively, add an alias to your shell

```
echo "alias nac-web='nono run --profile nac-web -- ~/bin/nac-web'" >> ~/.zshrc
source ~/.zshrc
type nac-web
```
